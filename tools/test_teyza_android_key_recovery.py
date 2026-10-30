import base64
import contextlib
import hashlib
import io
import json
import os
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import patch

import teyza_android_key_recovery as recovery


class RecoveryTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.temporary = tempfile.TemporaryDirectory(prefix='teyza-recovery-fixture-')
        root = Path(cls.temporary.name)
        cls.password = 'disposable-fixture-password'
        env = dict(os.environ, TEYZA_FIXTURE_PASSWORD=cls.password)
        key = root / 'fixture.jks'
        subprocess.run(['keytool', '-genkeypair', '-keystore', str(key), '-storetype', 'JKS',
            '-alias', 'disposable-fixture-alias', '-keyalg', 'RSA', '-keysize', '2048', '-validity', '1',
            '-dname', 'CN=Disposable Recovery Fixture', '-storepass:env', 'TEYZA_FIXTURE_PASSWORD',
            '-keypass:env', 'TEYZA_FIXTURE_PASSWORD', '-noprompt'],
            env=env, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, check=True)
        cls.key = base64.b64encode(key.read_bytes()).decode()
        cls.der = subprocess.check_output(['keytool', '-exportcert', '-keystore', str(key),
            '-alias', 'disposable-fixture-alias', '-storepass:env', 'TEYZA_FIXTURE_PASSWORD'],
            env=env, stderr=subprocess.DEVNULL)
        cls.digest = hashlib.sha256(cls.der).hexdigest()

    @classmethod
    def tearDownClass(cls):
        cls.temporary.cleanup()

    def settings(self):
        return {'ANDROID_KEYSTORE_BASE64': self.key, 'KEYSTORE_PASSWORD': self.password,
                'KEY_PASSWORD': 'wrong-key-password-for-fallback-check', 'GH_TOKEN': 'disposable-token'}

    def test_restore_requires_exact_certificate_and_verified_private_key(self):
        with tempfile.TemporaryDirectory() as folder, patch.object(recovery, 'check_target_access') as access, \
                patch.object(recovery, 'write_secret') as secret, patch.object(recovery, 'write_pin') as pin:
            output = io.StringIO()
            with contextlib.redirect_stdout(output):
                report = recovery.recover(self.settings(), Path(folder), restore=True, expected=self.digest)
            self.assertTrue(report['restored'])
            self.assertEqual(report['sourceSlot'], 'ANDROID_KEYSTORE_BASE64')
            self.assertEqual(secret.call_count, 4)
            access.assert_called_once()
            pin.assert_called_once_with(self.digest, 'disposable-token')
            calls = {call.args[0]: call.args[1] for call in secret.call_args_list}
            self.assertEqual(calls['TEYZA_ANDROID_KEY_PASSWORD'], self.password)
            self.assertEqual(calls['TEYZA_ANDROID_KEY_ALIAS'], 'disposable-fixture-alias')
            self.assertEqual((Path(folder)/'teyza-upload.cer').read_bytes(), self.der)
            self.assertEqual(set(p.name for p in Path(folder).iterdir()), {'teyza-upload.cer','teyza-upload.pem','recovery-summary.json'})
            self.assertNotIn(self.password, output.getvalue())
            self.assertNotIn(self.key, output.getvalue())
            self.assertNotIn('disposable-fixture-alias', output.getvalue())

    def test_wrong_certificate_never_changes_target_settings(self):
        with tempfile.TemporaryDirectory() as folder, patch.object(recovery, 'check_target_access') as access, \
                patch.object(recovery, 'write_secret') as secret:
            with contextlib.redirect_stdout(io.StringIO()), self.assertRaises(recovery.RecoveryError):
                recovery.recover(self.settings(), Path(folder), restore=True, expected='0'*64)
            access.assert_not_called()
            secret.assert_not_called()
            self.assertEqual(set(p.name for p in Path(folder).iterdir()), {'recovery-summary.json'})

    def test_audit_does_not_restore_and_unreadable_backups_cannot_be_copied(self):
        with tempfile.TemporaryDirectory() as folder, patch.object(recovery, 'write_secret') as secret:
            with contextlib.redirect_stdout(io.StringIO()):
                report = recovery.recover(self.settings(), Path(folder), expected=self.digest)
            self.assertTrue(report['matched'])
            self.assertFalse(report['restored'])
            secret.assert_not_called()
        bad = self.settings()
        bad['KEYSTORE_PASSWORD'] = 'wrong-store-password'
        with tempfile.TemporaryDirectory() as folder, patch.object(recovery, 'write_secret') as secret:
            with contextlib.redirect_stdout(io.StringIO()), self.assertRaises(recovery.RecoveryError):
                recovery.recover(bad, Path(folder), restore=True, expected=self.digest)
            secret.assert_not_called()

    def test_certificate_match_without_private_key_proof_cannot_restore(self):
        with tempfile.TemporaryDirectory() as folder, patch.object(recovery, 'can_sign', return_value=False), \
                patch.object(recovery, 'check_target_access') as access, patch.object(recovery, 'write_secret') as secret:
            with contextlib.redirect_stdout(io.StringIO()), self.assertRaises(recovery.RecoveryError):
                recovery.recover(self.settings(), Path(folder), restore=True, expected=self.digest)
            access.assert_not_called()
            secret.assert_not_called()

    def test_missing_transfer_token_cannot_restore(self):
        settings = self.settings()
        settings.pop('GH_TOKEN')
        with tempfile.TemporaryDirectory() as folder, patch.object(recovery, 'write_secret') as secret:
            with contextlib.redirect_stdout(io.StringIO()), self.assertRaises(recovery.RecoveryError):
                recovery.recover(settings, Path(folder), restore=True, expected=self.digest)
            secret.assert_not_called()
if __name__ == '__main__':
    unittest.main()
