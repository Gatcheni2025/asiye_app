from pathlib import Path
import plistlib
import subprocess
import sys
import tempfile
import unittest
import zipfile

class SignedIosMetadataTests(unittest.TestCase):
    def test_signed_metadata_rejects_an_old_sdk_or_incompatible_deployment_minimum(self):
        validator=Path(__file__).resolve().parents[1]/'scripts/verify_asiye_ios_metadata.py'
        with tempfile.TemporaryDirectory() as d:
            p=Path(d)/'candidate.ipa'
            for sdk,minimum,passed in [('iphoneos26.2','15.5',True),('iphoneos27.0','15.5',True),('iphoneos25.0','15.5',False),('iphoneos26.2','15.0',False)]:
                info={'CFBundleIdentifier':'com.asiyeapp.asiye','CFBundleShortVersionString':'46522.0.6','CFBundleVersion':'99999',
                      'ITSAppUsesNonExemptEncryption':False,'DTSDKName':sdk,'MinimumOSVersion':minimum}
                with zipfile.ZipFile(p,'w') as z:z.writestr('Payload/Runner.app/Info.plist',plistlib.dumps(info))
                r=subprocess.run([sys.executable,str(validator),'--ipa',str(p),'--version','46522.0.6','--build','99999'],capture_output=True,text=True)
                self.assertEqual(r.returncode==0,passed,r.stdout+r.stderr)
if __name__=='__main__':unittest.main()
