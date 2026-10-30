#!/usr/bin/env python3
"""Compare reviewed WebView assets with the actual signed mobile package."""
import argparse
import hashlib
from pathlib import Path
import re
import zipfile

REQUIRED = (
    'passenger-v2/index.html', 'passenger-v2/js/app.js', 'passenger-v2/js/profile.js', 'passenger-v2/css/booking-face.css',
    'passenger-v2/login.html', 'passenger-v2/js/login.js',
    'passenger-v2/js/firebase.js', 'passenger-v2/css/login.css',
    'driver-v2/js/enrollment.js', 'driver-v2/js/enrollment-gate.js',
    'driver-v2/login.html', 'driver-v2/js/login.js', 'driver-v2/js/firebase.js',
    'native-auth-session.js', 'passenger-v2/js/onboarding.js',
    'passenger-v2/js/booking.js', 'passenger-v2/js/ride-controller.js',
    'passenger-v2/js/wallet.js', 'passenger-v2/js/club.js',
    'passenger-v2/js/parcels.js', 'driver-v2/js/requests.js',
    'driver-v2/js/trip-controller.js', 'club-live.js', 'payment-status.html',
    'driver-v2/index.html', 'driver-v2/js/app.js', 'member-pages.js', 'member-pages.css',
    'driver-v2/payout.html', 'driver-v2/js/payout.js', 'driver-v2/css/payout.css',
    'driver-v2/css/app.css',
)


def verify_bundle(artifact, assets, expected_project, required=REQUIRED):
    artifact, assets = Path(artifact), Path(assets)
    with zipfile.ZipFile(artifact) as bundle:
        names = bundle.namelist()
        if len(names) != len(set(names)):
            raise ValueError('Duplicate ZIP entries in mobile package')
        prefixes = {
            '.apk': 'assets/flutter_assets/assets/',
            '.aab': 'base/assets/flutter_assets/assets/',
        }
        if artifact.suffix == '.ipa':
            matches = [name[:-len('native-auth-session.js')] for name in names
                       if re.fullmatch(r'Payload/[^/]+\.app/Frameworks/App\.framework/flutter_assets/assets/native-auth-session\.js', name)]
            if len(matches) != 1:
                raise ValueError('Missing or ambiguous IPA Flutter asset root')
            prefix = matches[0]
        else:
            prefix = prefixes.get(artifact.suffix)
            if prefix is None:
                raise ValueError('Expected an APK, AAB or IPA')
        digests = {}
        for relative in required:
            source = (assets / relative).read_bytes()
            try:
                packed = bundle.read(prefix + relative)
            except KeyError as error:
                raise ValueError('Missing bundled asset: ' + relative) from error
            if packed != source:
                raise ValueError('Stale bundled asset: ' + relative)
            if relative.endswith('/js/firebase.js'):
                project = re.search(rb'\bprojectId\s*:\s*[\'"]([^\'"]+)[\'"]', packed)
                if project is None or project[1].decode() != expected_project:
                    raise ValueError('Bundled Firebase project mismatch: ' + relative)
            digests[relative] = hashlib.sha256(packed).hexdigest()
    return digests


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--artifact', required=True, type=Path)
    parser.add_argument('--expected-project', required=True)
    parser.add_argument('--assets', type=Path, default=Path(__file__).resolve().parents[1] / 'assets')
    args = parser.parse_args()
    try:
        matched = verify_bundle(args.artifact, args.assets, args.expected_project)
        print(f'PASS {args.artifact.name}: {len(matched)} reviewed WebView assets match source; Firebase project {args.expected_project}')
    except (ValueError, OSError, zipfile.BadZipFile) as error:
        parser.exit(1, f'MOBILE_ASSET_PARITY: BLOCKED {error}\n')
