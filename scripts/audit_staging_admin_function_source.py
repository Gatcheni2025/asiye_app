#!/usr/bin/env python3
"""Read-only proof of the two driver-admin deployments before resuming Hosting."""
import json
from pathlib import Path
import urllib.parse
import urllib.request
try:
    from .audit_staging_function_source import compare_archive, command, ROOT, PROJECT, NUMBER
except ImportError:
    from audit_staging_function_source import compare_archive, command, ROOT, PROJECT, NUMBER


def verify_inventory(inventory, names, expected, read_archive):
    by_name = {item.get('name', '').split('/')[-1]: item for item in inventory}
    report = {'matched': [], 'blocked': [], 'mismatched': []}
    cache = {}
    for name in names:
        item = by_name.get(name, {})
        build = item.get('buildConfig', {})
        src = build.get('sourceProvenance', {}).get('resolvedStorageSource', {})
        bucket, obj, generation = (str(src.get(k, '')) for k in ('bucket', 'object', 'generation'))
        if (item.get('name') not in {f'projects/{p}/locations/us-central1/functions/{name}' for p in (PROJECT, NUMBER)} or
                item.get('state') != 'ACTIVE' or build.get('entryPoint') != name or
                build.get('runtime') != 'nodejs22' or not bucket or not obj or not generation):
            report['blocked'].append({'name': name, 'reason': 'ACTIVE_REVIEWED_BUILD_UNAVAILABLE'})
            continue
        if NUMBER not in bucket and PROJECT not in bucket:
            report['blocked'].append({'name': name, 'reason': 'SOURCE_BUCKET_NOT_STAGING'})
            continue
        key = (bucket, obj, generation)
        if key not in cache:
            try:
                cache[key] = {'differences': compare_archive(read_archive(*key), expected)}
            except Exception:
                cache[key] = {'blocked': 'SOURCE_ARCHIVE_READ_FAILED'}
        result = cache[key]
        if 'blocked' in result:
            report['blocked'].append({'name': name, 'reason': result['blocked']})
        elif result['differences']:
            report['mismatched'].append({'name': name, 'files': result['differences']})
        else:
            report['matched'].append(name)
    report['ok'] = len(report['matched']) == len(names) == 2
    return report


def main():
    try:
        if (command(['gcloud', 'config', 'get-value', 'project']) != PROJECT or
                command(['gcloud', 'projects', 'describe', PROJECT, '--format=value(projectNumber)']) != NUMBER):
            raise ValueError('STAGING_PROJECT_IDENTITY_MISMATCH')
        names = json.loads((ROOT / 'scripts/staging_driver_admin_functions.json').read_text())
        expected = {p.name: p.read_bytes() for p in (ROOT / 'functions').glob('*.js')}
        pkg = json.loads((ROOT / 'functions/package.json').read_text())
        pkg['main'] = 'staging-index.generated.cjs'
        expected['package.json'] = json.dumps(pkg).encode()
        expected[pkg['main']] = command(['node', '-e',
            "const names=[...new Set([...require('./scripts/paystack_function_manifest.json'),"
            "...require('./scripts/auth_booking_staging_functions.json'),...require('./scripts/staging_driver_admin_functions.json')])];"
            "process.stdout.write(require('./scripts/prepare_staging_function_scope.cjs').renderEntry(names));"]).encode() + b'\n'
        inventory = json.loads(command(['gcloud', 'functions', 'list', '--v2', '--regions=us-central1',
            '--project=' + PROJECT,
            '--format=json(name,state,buildConfig.runtime,buildConfig.entryPoint,buildConfig.sourceProvenance.resolvedStorageSource)']))
        token = command(['gcloud', 'auth', 'print-access-token'])
        def read_archive(bucket, obj, generation):
            url = ('https://storage.googleapis.com/storage/v1/b/' + urllib.parse.quote(bucket, safe='') +
                   '/o/' + urllib.parse.quote(obj, safe='') + '?' +
                   urllib.parse.urlencode({'alt': 'media', 'generation': generation}))
            request = urllib.request.Request(url, headers={'Authorization': 'Bearer ' + token})
            with urllib.request.urlopen(request, timeout=30) as response:
                data = response.read(80 * 1024 * 1024 + 1)
            if len(data) > 80 * 1024 * 1024:
                raise ValueError('ARCHIVE_SIZE_LIMIT')
            return data
        report = verify_inventory(inventory, names, expected, read_archive)
        print('STAGING_ADMIN_FUNCTION_SOURCE: MATCH=' + str(len(report['matched'])) + '/2')
        for kind in ('blocked', 'mismatched'):
            for item in report[kind]:
                print('SOURCE_' + kind.upper() + ': ' + item['name'] + ' ' +
                      str(item.get('reason', ','.join(item.get('files', [])))))
        return 0 if report['ok'] else 2
    except Exception as error:
        print('STAGING_ADMIN_FUNCTION_SOURCE: BLOCKED ' +
              (str(error) if isinstance(error, ValueError) else 'READ_ONLY_SOURCE_CHECK_FAILED'))
        return 2


if __name__ == '__main__':
    raise SystemExit(main())
