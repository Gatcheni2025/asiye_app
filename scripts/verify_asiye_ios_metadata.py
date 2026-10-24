#!/usr/bin/env python3
"""Verify built or signed Asiye iOS app metadata before TestFlight upload."""
import argparse
import plistlib
import pathlib
import sys
import zipfile
import re

parser = argparse.ArgumentParser()
target = parser.add_mutually_exclusive_group(required=True)
target.add_argument('--app', help='Path to built Runner.app directory')
target.add_argument('--ipa', help='Path to signed IPA')
parser.add_argument('--version', required=True)
parser.add_argument('--build', required=True)
args = parser.parse_args()

if args.app:
    with open(pathlib.Path(args.app) / 'Info.plist', 'rb') as stream:
        info = plistlib.load(stream)
else:
    with zipfile.ZipFile(args.ipa) as archive:
        paths = [p for p in archive.namelist() if p.startswith('Payload/') and p.count('/') == 2 and p.endswith('.app/Info.plist')]
        if not paths:
            paths = [p for p in archive.namelist() if p.startswith('Payload/') and p.endswith('.app/Info.plist')]
        if len(paths) != 1:
            sys.exit('FAIL: IPA must contain exactly one top-level .app/Info.plist')
        info = plistlib.loads(archive.read(paths[0]))

expected = {
    'CFBundleIdentifier': 'com.asiyeapp.asiye',
    'CFBundleShortVersionString': args.version,
    'CFBundleVersion': args.build,
    'ITSAppUsesNonExemptEncryption': False,
}
for key, value in expected.items():
    if info.get(key) != value:
        sys.exit(f'FAIL: {key}: expected {value!r}, got {info.get(key)!r}')
sdk = re.fullmatch(r'iphoneos(\d+)(?:\.\d+)*', str(info.get('DTSDKName','')))
minimum = tuple(int(value) for value in str(info.get('MinimumOSVersion','0')).split('.'))
if not sdk or int(sdk[1]) < 26:
    sys.exit('FAIL: signed app must use the iOS 26 SDK or later.')
if minimum < (15,5):
    sys.exit('FAIL: signed app minimum must cover the existing iOS 15.5 native dependency requirement.')
print(f'PASS signed/built iOS app version {args.version} ({args.build}), bundle and export compliance.')
print(f"PASS actual SDK {info['DTSDKName']} and minimum iOS {info['MinimumOSVersion']}.")
