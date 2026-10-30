"""Recover only the existing Teyza Play upload key; never export private keys."""
import argparse
import base64
import hashlib
import json
import os
from pathlib import Path
import re
import ssl
import subprocess
import tempfile
import textwrap
import zipfile

TARGET_REPO = 'Gatcheni2025/Business-lift'
TARGET_PACKAGE = 'com.asiyedriver.asiye'
EXPECTED_SHA256 = 'e558b690447577f9c7352664747287098a6811dd7f0a8fac39c6689c17e62608'
SOURCE_REPO = 'Gatcheni2025/asiye_app'
SOURCE_REF = 'refs/heads/fix/teyza-legacy-android-key'
CANDIDATES = ('KEYSTORE_BASE64', 'ANDROID_KEYSTORE_BASE64')


class RecoveryError(Exception):
    pass


def process_env():
    return {k: v for k, v in os.environ.items() if k not in
            {*CANDIDATES, 'KEYSTORE_PASSWORD', 'KEY_PASSWORD', 'KEY_ALIAS', 'GH_TOKEN'}}


def certificates(path, password):
    env = process_env()
    env['TEYZA_RECOVERY_STORE_PASSWORD'] = password
    command = ['keytool', '-J-Duser.language=en', '-J-Duser.country=US', '-list', '-rfc',
               '-keystore', str(path), '-storepass:env', 'TEYZA_RECOVERY_STORE_PASSWORD']
    reply = subprocess.run(command, env=env, capture_output=True, text=True, timeout=30)
    if reply.returncode:
        return []
    found = []
    for block in re.split(r'(?m)^Alias name: ', reply.stdout)[1:]:
        if 'Entry type: PrivateKeyEntry' not in block:
            continue
        pem = re.search(r'-----BEGIN CERTIFICATE-----[\s\S]+?-----END CERTIFICATE-----', block)
        if not pem:
            continue
        try:
            der = ssl.PEM_cert_to_DER_cert(pem[0])
        except ValueError:
            continue
        found.append((block.splitlines()[0].strip(), der))
    return found


def can_sign(path, alias, store_password, key_password, folder):
    source, signed = folder / 'probe.jar', folder / 'signed-probe.jar'
    with zipfile.ZipFile(source, 'w') as archive:
        archive.writestr('verification.txt', 'Teyza upload-key possession check only.\n')
    signed.unlink(missing_ok=True)
    env = process_env()
    env.update(TEYZA_RECOVERY_STORE_PASSWORD=store_password, TEYZA_RECOVERY_KEY_PASSWORD=key_password)
    signer = ['java', '-Duser.language=en', '-Duser.country=US',
              '-m', 'jdk.jartool/sun.security.tools.jarsigner.Main']
    reply = subprocess.run([*signer,
        '-keystore', str(path), '-storepass:env', 'TEYZA_RECOVERY_STORE_PASSWORD',
        '-keypass:env', 'TEYZA_RECOVERY_KEY_PASSWORD', '-signedjar', str(signed), str(source), alias],
        env=env, capture_output=True, timeout=30)
    if reply.returncode:
        return False
    verified = subprocess.run([*signer, '-verify', str(signed)],
        env=process_env(), capture_output=True, text=True, timeout=30)
    return verified.returncode == 0 and 'jar verified.' in verified.stdout.lower()


def check_target_access(token):
    env = process_env()
    env['GH_TOKEN'] = token
    reply = subprocess.run(['gh', 'api', 'repos/' + TARGET_REPO + '/actions/secrets/public-key'],
                           env=env, capture_output=True, timeout=30)
    if reply.returncode:
        raise RecoveryError('The existing transfer token cannot access Teyza signing-secret settings. No target secrets were changed.')


def write_secret(name, value, token):
    env = process_env()
    env['GH_TOKEN'] = token
    reply = subprocess.run(['gh', 'secret', 'set', name, '--repo', TARGET_REPO],
        input=value.encode(), env=env, capture_output=True, timeout=30)
    if reply.returncode:
        raise RecoveryError('Could not finish restoring verified Android signing settings. Rerun this guarded recovery; the source backup is unchanged.')


def write_pin(fingerprint, token):
    env = process_env()
    env['GH_TOKEN'] = token
    reply = subprocess.run(['gh', 'variable', 'set', 'TEYZA_PLAY_UPLOAD_CERT_SHA256',
        '--repo', TARGET_REPO, '--body', fingerprint.upper()], env=env, capture_output=True, timeout=30)
    if reply.returncode:
        raise RecoveryError('The key settings were restored but the public Play fingerprint was not saved. Rerun this recovery.')


def recover(settings, output, restore=False, expected=EXPECTED_SHA256):
    output.mkdir(parents=True, exist_ok=True)
    report = {'targetRepository': TARGET_REPO, 'applicationId': TARGET_PACKAGE,
              'expectedUploadSha256': expected, 'matched': False, 'restored': False, 'candidates': []}
    report_path = output / 'recovery-summary.json'
    match = None
    with tempfile.TemporaryDirectory(prefix='teyza-private-key-check-') as temporary:
        folder = Path(temporary)
        for name in CANDIDATES:
            raw = settings.get(name, '')
            entry = {'slot': name, 'present': bool(raw), 'certificateSha256': [], 'signingVerified': False}
            report['candidates'].append(entry)
            if not raw or not settings.get('KEYSTORE_PASSWORD'):
                continue
            try:
                data = base64.b64decode(''.join(raw.split()), validate=True)
            except (ValueError, TypeError):
                continue
            path = folder / (name + '.keystore')
            path.write_bytes(data)
            for alias, der in certificates(path, settings['KEYSTORE_PASSWORD']):
                digest = hashlib.sha256(der).hexdigest()
                entry['certificateSha256'].append(digest)
                if digest != expected:
                    continue
                passwords = list(dict.fromkeys([settings.get('KEY_PASSWORD', ''), settings['KEYSTORE_PASSWORD']]))
                for password in passwords:
                    if password and can_sign(path, alias, settings['KEYSTORE_PASSWORD'], password, folder):
                        entry['signingVerified'] = True
                        match = (name, data, alias, password, der)
                        break
                if match:
                    break
            if match:
                break
        if match:
            name, data, alias, password, der = match
            report.update(matched=True, sourceSlot=name)
            (output / 'teyza-upload.cer').write_bytes(der)
            pem = '-----BEGIN CERTIFICATE-----\n' + '\n'.join(textwrap.wrap(base64.b64encode(der).decode(), 64)) + '\n-----END CERTIFICATE-----\n'
            (output / 'teyza-upload.pem').write_text(pem)
        report_path.write_text(json.dumps(report, indent=2) + '\n')
        print(json.dumps(report))
        if not match:
            raise RecoveryError('No matching usable private key was verified in the available GitHub slots. No Teyza settings were changed. An unreadable backup may need its original password.')
        if restore:
            token = settings.get('GH_TOKEN', '')
            if not token:
                raise RecoveryError('A verified key was found, but the existing transfer token is unavailable. No target secrets were changed.')
            check_target_access(token)
            values = [('TEYZA_ANDROID_STORE_PASSWORD', settings['KEYSTORE_PASSWORD']),
                      ('TEYZA_ANDROID_KEY_PASSWORD', password), ('TEYZA_ANDROID_KEY_ALIAS', alias),
                      ('TEYZA_ANDROID_KEYSTORE_BASE64', base64.b64encode(data).decode())]
            for target, value in values:
                write_secret(target, value, token)
            write_pin(expected, token)
            report['restored'] = True
            report_path.write_text(json.dumps(report, indent=2) + '\n')
            print('Verified original Teyza Play upload key restored to Business-lift. Source signing settings and iOS settings are unchanged.')
    return report


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--restore', action='store_true')
    args = parser.parse_args()
    if os.environ.get('GITHUB_REPOSITORY') != SOURCE_REPO or os.environ.get('GITHUB_REF') != SOURCE_REF:
        raise RecoveryError('Run this helper only through the dedicated Asiye recovery branch.')
    os.umask(0o077)
    output = Path(os.environ['RUNNER_TEMP']) / 'teyza-legacy-android-public'
    recover(os.environ, output, restore=args.restore)


if __name__ == '__main__':
    try:
        main()
    except (RecoveryError, OSError, subprocess.SubprocessError) as error:
        # Never include subprocess arguments, passwords, aliases or key data.
        print(str(error) if isinstance(error, RecoveryError) else 'Signing-key verification could not complete; no private key material was exported.')
        raise SystemExit(1)
