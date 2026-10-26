"""Transfer existing Match signing identity to the owner's Teyza repository.

No private data is written to disk, stdout, artifacts or command arguments.
Match v1/v2 formats follow fastlane/match encryption/encryption.rb.
"""
import base64
import datetime
import hashlib
import json
import os
import plistlib
import secrets
import subprocess
import sys
import urllib.error
import urllib.request

from cryptography import x509
from cryptography.hazmat.primitives import hashes, padding, serialization
from cryptography.hazmat.primitives.ciphers import Cipher, algorithms, modes
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from cryptography.hazmat.primitives.serialization import pkcs12
from cryptography.x509.oid import NameOID

SOURCE = 'Gatcheni2025/asiye-certs'
TARGET = 'Gatcheni2025/Business-lift'
TEAM = 'AC775BUGG5'
BUNDLE = 'za.co.teyza.shopper'
STAGE = 'configuration'


def decrypt_candidates(encoded, password):
    raw = base64.b64decode(encoded)
    password = password.encode('utf-8')
    if raw.startswith(b'match_encrypted_v2__'):
        # Prefix is 20 bytes; tag precedes ciphertext in Match storage.
        keyiv = hashlib.pbkdf2_hmac('sha256', password, raw[20:28], 10000, 68)
        yield AESGCM(keyiv[:32]).decrypt(keyiv[32:44], raw[44:] + raw[28:44], keyiv[44:])
    elif raw.startswith(b'Salted__'):
        for digest in ('md5', 'sha256'):
            material = b''
            previous = b''
            while len(material) < 48:
                previous = hashlib.new(digest, previous + password + raw[8:16]).digest()
                material += previous
            try:
                dec = Cipher(algorithms.AES(material[:32]), modes.CBC(material[32:48])).decryptor()
                padded = dec.update(raw[16:]) + dec.finalize()
                unpad = padding.PKCS7(128).unpadder()
                yield unpad.update(padded) + unpad.finalize()
            except ValueError:
                continue
    else:
        raise ValueError('Unsupported encrypted Match file format')


def parse_certificate(encoded, password):
    for data in decrypt_candidates(encoded, password):
        try:
            return x509.load_der_x509_certificate(data)
        except ValueError:
            try:
                return x509.load_pem_x509_certificate(data)
            except ValueError:
                continue
    raise ValueError('Cannot decrypt distribution certificate with saved MATCH_PASSWORD')


def parse_private_key(encoded, password):
    for data in decrypt_candidates(encoded, password):
        for loader in (serialization.load_pem_private_key, serialization.load_der_private_key):
            try:
                return loader(data, password=None)
            except (ValueError, TypeError):
                pass
        try:
            key, _, _ = pkcs12.load_key_and_certificates(data, None)
            if key is not None:
                return key
        except (ValueError, TypeError):
            pass
    raise ValueError('Cannot decrypt matching distribution private key')


def validate_profile(profile, now=None):
    now = now or datetime.datetime.now(datetime.timezone.utc)
    ent = profile.get('Entitlements', {})
    if profile.get('TeamIdentifier') != [TEAM] or ent.get('application-identifier') != TEAM + '.' + BUNDLE:
        raise ValueError('Profile does not belong to the Teyza bundle and Apple team')
    if ent.get('com.apple.developer.team-identifier') != TEAM:
        raise ValueError('Profile team entitlement differs from Teyza team')
    expiry = profile.get('ExpirationDate')
    if not isinstance(expiry, datetime.datetime) or expiry.replace(tzinfo=datetime.timezone.utc) <= now:
        raise ValueError('Teyza profile has expired or has no expiration date')
    if ent.get('get-task-allow') or profile.get('ProvisionedDevices') or profile.get('ProvisionsAllDevices'):
        raise ValueError('Teyza requires an App Store distribution profile')
    if ent.get('aps-environment') != 'production' or 'Default' not in ent.get('com.apple.developer.applesignin', []):
        raise ValueError('Profile must enable production Push Notifications and Sign in with Apple')
    certs = profile.get('DeveloperCertificates', [])
    if len(certs) != 1:
        raise ValueError('Expected the single distribution certificate chosen for Teyza')
    return x509.load_der_x509_certificate(certs[0])


def make_identity(cert, key, profile_cert, now=None):
    now = now or datetime.datetime.now(datetime.timezone.utc)
    if cert.fingerprint(hashes.SHA256()) != profile_cert.fingerprint(hashes.SHA256()):
        raise ValueError('Existing certificate does not match Teyza profile')
    if not cert.not_valid_before_utc <= now < cert.not_valid_after_utc:
        raise ValueError('Matching distribution certificate is not currently valid')
    if TEAM not in [a.value for a in cert.subject.get_attributes_for_oid(NameOID.ORGANIZATIONAL_UNIT_NAME)]:
        raise ValueError('Matching certificate belongs to another Apple team')
    pub = lambda k: k.public_bytes(serialization.Encoding.DER, serialization.PublicFormat.SubjectPublicKeyInfo)
    if pub(key.public_key()) != pub(cert.public_key()):
        raise ValueError('Certificate and private key do not match')
    password = secrets.token_urlsafe(32)
    value = pkcs12.serialize_key_and_certificates(b'Teyza Apple Distribution', key, cert, None,
                                               serialization.BestAvailableEncryption(password.encode('ascii')))
    # Round trip before any remote signing values are replaced.
    loaded_key, loaded_cert, _ = pkcs12.load_key_and_certificates(value, password.encode('ascii'))
    if loaded_key is None or loaded_cert.fingerprint(hashes.SHA256()) != cert.fingerprint(hashes.SHA256()):
        raise ValueError('Exported signing identity failed validation')
    return value, password


def api(path):
    req = urllib.request.Request('https://api.github.com/' + path, headers={
        'Authorization': 'Bearer ' + os.environ['GH_TOKEN'],
        'Accept': 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28'})
    with urllib.request.urlopen(req, timeout=30) as response:
        return json.load(response)


def content(path):
    item = api('repos/' + SOURCE + '/contents/' + path + '?ref=master')
    if item.get('encoding') != 'base64':
        raise ValueError('Unexpected certificate file encoding')
    return base64.b64decode(item['content'])


def set_secret(name, value):
    proc = subprocess.run(['gh', 'secret', 'set', name, '--repo', TARGET], input=value.encode('ascii'),
                          stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=60)
    if proc.returncode:
        raise ValueError('Could not save ' + name + '; transfer token needs Secrets write access to Business-lift')


def main():
    global STAGE
    for name in ('GH_TOKEN', 'MATCH_PASSWORD', 'TEYZA_PROFILE_BASE64'):
        if not os.environ.get(name):
            raise ValueError('Missing ' + name + '; configure the source workflow secret first')
    # Verify destination visibility before decrypting anything.
    STAGE = 'checking Business-lift secret access'
    print('Checking Business-lift secret access.', flush=True)
    api('repos/' + TARGET + '/actions/secrets/public-key')
    STAGE = 'validating Teyza provisioning profile'
    print('Validating Teyza provisioning profile.', flush=True)
    profile_raw = base64.b64decode(os.environ['TEYZA_PROFILE_BASE64'].strip(), validate=True)
    decoded = subprocess.run(['openssl', 'cms', '-verify', '-noverify', '-inform', 'DER'], input=profile_raw,
                             stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=30)
    if decoded.returncode:
        raise ValueError('Cannot decode the signed Teyza provisioning profile')
    profile_cert = validate_profile(plistlib.loads(decoded.stdout))
    STAGE = 'reading asiye-certs distribution files'
    print('Reading asiye-certs distribution files.', flush=True)
    entries = api('repos/' + SOURCE + '/contents/certs/distribution?ref=master')
    selected = None
    for entry in entries:
        if entry.get('type') == 'file' and entry['name'].endswith('.cer'):
            STAGE = 'decrypting existing distribution certificate'
            cert = parse_certificate(content(entry['path']), os.environ['MATCH_PASSWORD'])
            if cert.fingerprint(hashes.SHA256()) == profile_cert.fingerprint(hashes.SHA256()):
                selected = (entry['path'][:-4] + '.p12', cert)
                break
    if selected is None:
        raise ValueError('No certificate in asiye-certs matches Teyza profile; no secrets changed')
    STAGE = 'decrypting matching private key'
    print('Matching certificate found; validating its private key.', flush=True)
    key = parse_private_key(content(selected[0]), os.environ['MATCH_PASSWORD'])
    identity, password = make_identity(selected[1], key, profile_cert)
    # Only the encrypted PKCS12 is sent; its random password goes as a separate secret.
    STAGE = 'saving Teyza signing secrets'
    set_secret('TEYZA_IOS_CERTIFICATE_BASE64', base64.b64encode(identity).decode('ascii'))
    set_secret('TEYZA_IOS_CERTIFICATE_PASSWORD', password)
    set_secret('TEYZA_IOS_KEYCHAIN_PASSWORD', secrets.token_urlsafe(32))
    print('Teyza signing certificate matched its App Store profile; all three signing secrets saved.')
    print('No certificates or profiles were created, revoked, or modified in Apple or asiye-certs.')


if __name__ == '__main__':
    try:
        main()
    except urllib.error.HTTPError as error:
        print('Signing setup stopped while ' + STAGE + ': GitHub HTTP ' + str(error.code) +
              '. Check transfer-token repository access and expiry.', file=sys.stderr)
        sys.exit(1)
    except Exception:
        # Never include API responses, environment values, or private parsing data in logs.
        print('Signing setup stopped while ' + STAGE +
              '. Check profile, MATCH_PASSWORD, and transfer-token repository permissions.', file=sys.stderr)
        sys.exit(1)
