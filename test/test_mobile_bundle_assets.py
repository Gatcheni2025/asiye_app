import tempfile
from pathlib import Path
import unittest
import zipfile

from scripts.verify_mobile_bundle_assets import verify_bundle


class MobileAssetParityTests(unittest.TestCase):
    def test_signed_package_formats_accept_current_assets_and_reject_stale_auth(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            assets = root / 'assets'
            (assets / 'passenger-v2/js').mkdir(parents=True)
            required = ('native-auth-session.js', 'passenger-v2/js/firebase.js')
            (assets / required[0]).write_text('current phone link bridge')
            (assets / required[1]).write_text('const config={projectId:"asiye-paystack-staging"}')
            for extension, prefix in (
                ('apk', 'assets/flutter_assets/assets/'),
                ('aab', 'base/assets/flutter_assets/assets/'),
                ('ipa', 'Payload/Runner.app/Frameworks/App.framework/flutter_assets/assets/'),
            ):
                artifact = root / ('candidate.' + extension)
                for stale in (False, True):
                    with zipfile.ZipFile(artifact, 'w') as package:
                        for relative in required:
                            data = b'old auth' if stale and relative == required[0] else (assets / relative).read_bytes()
                            package.writestr(prefix + relative, data)
                    if stale:
                        with self.assertRaisesRegex(ValueError, 'Stale bundled asset'):
                            verify_bundle(artifact, assets, 'asiye-paystack-staging', required)
                    else:
                        self.assertEqual(len(verify_bundle(artifact, assets, 'asiye-paystack-staging', required)), 2)
                        with self.assertRaisesRegex(ValueError, 'Firebase project mismatch'):
                            verify_bundle(artifact, assets, 'asiye-80386', required)


if __name__ == '__main__':
    unittest.main()
