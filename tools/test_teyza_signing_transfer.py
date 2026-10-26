import base64
import datetime
import hashlib
import io
import os
import plistlib
import unittest
from contextlib import redirect_stdout
from types import SimpleNamespace
from unittest.mock import patch

from cryptography import x509
from cryptography.hazmat.primitives import hashes, padding, serialization
from cryptography.hazmat.primitives.asymmetric import rsa
from cryptography.hazmat.primitives.ciphers import Cipher, algorithms, modes
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from cryptography.hazmat.primitives.serialization import pkcs12
from cryptography.x509.oid import NameOID

import teyza_signing_transfer as t


class SigningTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.now = datetime.datetime.now(datetime.timezone.utc)
        cls.key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
        name = x509.Name([x509.NameAttribute(NameOID.COMMON_NAME, 'Disposable test certificate'),
                          x509.NameAttribute(NameOID.ORGANIZATIONAL_UNIT_NAME, t.TEAM)])
        cls.cert = (x509.CertificateBuilder().subject_name(name).issuer_name(name)
                    .public_key(cls.key.public_key()).serial_number(x509.random_serial_number())
                    .not_valid_before(cls.now - datetime.timedelta(days=1))
                    .not_valid_after(cls.now + datetime.timedelta(days=1)).sign(cls.key, hashes.SHA256()))

    def encrypt(self, data, version):
        password = b'fixture-only'
        salt = os.urandom(8)
        if version == 'v2':
            keyiv = hashlib.pbkdf2_hmac('sha256', password, salt, 10000, 68)
            result = AESGCM(keyiv[:32]).encrypt(keyiv[32:44], data, keyiv[44:])
            raw = b'match_encrypted_v2__' + salt + result[-16:] + result[:-16]
        else:
            material = b''
            previous = b''
            while len(material) < 48:
                previous = hashlib.new(version, previous + password + salt).digest()
                material += previous
            padder = padding.PKCS7(128).padder()
            padded = padder.update(data) + padder.finalize()
            cipher = Cipher(algorithms.AES(material[:32]), modes.CBC(material[32:48])).encryptor()
            raw = b'Salted__' + salt + cipher.update(padded) + cipher.finalize()
        return base64.b64encode(raw)

    def profile(self):
        return {'TeamIdentifier': [t.TEAM], 'ExpirationDate': self.now + datetime.timedelta(hours=4),
                'DeveloperCertificates': [self.cert.public_bytes(serialization.Encoding.DER)],
                'Entitlements': {'application-identifier': t.TEAM + '.' + t.BUNDLE,
                                 'com.apple.developer.team-identifier': t.TEAM,
                                 'aps-environment': 'production',
                                 'com.apple.developer.applesignin': ['Default']}}

    def test_all_match_formats_parse_real_certificate_and_key(self):
        for version in ('md5', 'sha256', 'v2'):
            with self.subTest(version=version):
                cert = t.parse_certificate(self.encrypt(self.cert.public_bytes(serialization.Encoding.DER), version), 'fixture-only')
                key_bytes = self.key.private_bytes(serialization.Encoding.PEM, serialization.PrivateFormat.PKCS8,
                                                   serialization.NoEncryption())
                key = t.parse_private_key(self.encrypt(key_bytes, version), 'fixture-only')
                identity, password = t.make_identity(cert, key, self.cert)
                _, restored, _ = pkcs12.load_key_and_certificates(identity, password.encode())
                self.assertEqual(restored.fingerprint(hashes.SHA256()), self.cert.fingerprint(hashes.SHA256()))

    def test_pkcs12_private_key_input(self):
        raw = pkcs12.serialize_key_and_certificates(b'fixture', self.key, self.cert, None, serialization.NoEncryption())
        self.assertIsNotNone(t.parse_private_key(self.encrypt(raw, 'v2'), 'fixture-only'))

    def test_wrong_password_rejected(self):
        with self.assertRaises(Exception):
            t.parse_certificate(self.encrypt(self.cert.public_bytes(serialization.Encoding.DER), 'v2'), 'incorrect')

    def test_valid_profile(self):
        self.assertEqual(t.validate_profile(self.profile()).serial_number, self.cert.serial_number)

    def test_wrong_bundle_team_expiry_and_distribution_rejected(self):
        for change in ('bundle', 'team', 'expired', 'development', 'devices', 'push', 'apple'):
            with self.subTest(change=change):
                p = self.profile()
                if change == 'bundle': p['Entitlements']['application-identifier'] = t.TEAM + '.com.asiyeapp.asiye'
                if change == 'team': p['TeamIdentifier'] = ['OTHERTEAM1']
                if change == 'expired': p['ExpirationDate'] = self.now - datetime.timedelta(days=1)
                if change == 'development': p['Entitlements']['get-task-allow'] = True
                if change == 'devices': p['ProvisionedDevices'] = ['fixture-device']
                if change == 'push': p['Entitlements']['aps-environment'] = 'development'
                if change == 'apple': del p['Entitlements']['com.apple.developer.applesignin']
                with self.assertRaises(ValueError): t.validate_profile(p)

    def test_wrong_private_key_rejected(self):
        other = rsa.generate_private_key(public_exponent=65537, key_size=2048)
        with self.assertRaises(ValueError): t.make_identity(self.cert, other, self.cert)

    def test_expired_certificate_rejected(self):
        with self.assertRaises(ValueError):
            t.make_identity(self.cert, self.key, self.cert, self.now + datetime.timedelta(days=2))

    def test_secrets_use_stdin(self):
        with patch.object(t.subprocess, 'run') as run:
            run.return_value.returncode = 0
            t.set_secret('TEYZA_IOS_CERTIFICATE_PASSWORD', 'fixture-secret')
            args, kwargs = run.call_args
            self.assertNotIn('fixture-secret', repr(args))
            self.assertEqual(kwargs['input'], b'fixture-secret')

    def test_missing_configuration_never_writes(self):
        with patch.dict(os.environ, {}, clear=True), patch.object(t, 'set_secret') as write:
            with self.assertRaises(ValueError): t.main()
            write.assert_not_called()

    def test_complete_transfer_with_mocked_github(self):
        cert_bytes = self.cert.public_bytes(serialization.Encoding.DER)
        key_bytes = self.key.private_bytes(serialization.Encoding.PEM, serialization.PrivateFormat.PKCS8,
                                           serialization.NoEncryption())
        files = {'certs/distribution/fixture.cer': self.encrypt(cert_bytes, 'v2'),
                 'certs/distribution/fixture.p12': self.encrypt(key_bytes, 'v2')}
        env = {'GH_TOKEN': 'fixture-token', 'MATCH_PASSWORD': 'fixture-only',
               'TEYZA_PROFILE_BASE64': base64.b64encode(b'fixture-cms').decode()}
        with patch.dict(os.environ, env, clear=True), patch.object(t, 'api') as api, \
                patch.object(t, 'content', side_effect=files.__getitem__), \
                patch.object(t.subprocess, 'run') as run, patch.object(t, 'set_secret') as write, \
                redirect_stdout(io.StringIO()) as output:
            api.side_effect = [{}, [{'name': 'fixture.cer', 'path': 'certs/distribution/fixture.cer', 'type': 'file'}]]
            run.return_value = SimpleNamespace(returncode=0, stdout=plistlib.dumps(self.profile()))
            t.main()
            values = dict(call.args for call in write.call_args_list)
            self.assertEqual(set(values), {'TEYZA_IOS_CERTIFICATE_BASE64', 'TEYZA_IOS_CERTIFICATE_PASSWORD',
                                           'TEYZA_IOS_KEYCHAIN_PASSWORD'})
            _, cert, _ = pkcs12.load_key_and_certificates(base64.b64decode(values['TEYZA_IOS_CERTIFICATE_BASE64']),
                                                         values['TEYZA_IOS_CERTIFICATE_PASSWORD'].encode())
            self.assertEqual(cert.serial_number, self.cert.serial_number)
            self.assertNotIn(values['TEYZA_IOS_CERTIFICATE_PASSWORD'], output.getvalue())

    def test_unmatched_profile_does_not_replace_secrets(self):
        env = {'GH_TOKEN': 'fixture-token', 'MATCH_PASSWORD': 'fixture-only',
               'TEYZA_PROFILE_BASE64': base64.b64encode(b'fixture-cms').decode()}
        with patch.dict(os.environ, env, clear=True), patch.object(t, 'api') as api, \
                patch.object(t.subprocess, 'run') as run, patch.object(t, 'set_secret') as write:
            api.side_effect = [{}, []]
            run.return_value = SimpleNamespace(returncode=0, stdout=plistlib.dumps(self.profile()))
            with self.assertRaises(ValueError): t.main()
            write.assert_not_called()


if __name__ == '__main__':
    unittest.main()
