#!/usr/bin/env python3
"""Read deployed staging build archives and compare reviewed function code."""
import hashlib
import io
import json
from pathlib import Path
import subprocess
import tarfile
import urllib.error
import urllib.parse
import urllib.request
import zipfile

ROOT = Path(__file__).resolve().parents[1]
PROJECT, NUMBER = 'asiye-paystack-staging', '1000800408896'


def command(args):
    result = subprocess.run(args, cwd=ROOT, capture_output=True, text=True, timeout=90)
    if result.returncode:
        raise ValueError('READ_ONLY_COMMAND_BLOCKED')
    return result.stdout.strip()


def compare_archive(data, expected):
    """Read code files only; never extract or print environment/credential files."""
    stream = io.BytesIO(data)
    if zipfile.is_zipfile(stream):
        with zipfile.ZipFile(stream) as archive:
            names = archive.namelist()
            if len(names) != len(set(names)):
                raise ValueError('DUPLICATE_ARCHIVE_ENTRIES')
            read = lambda name: archive.read(name)
            files = {name: read(name) for name in expected if name in names}
    else:
        stream.seek(0)
        with tarfile.open(fileobj=stream, mode='r:*') as archive:
            members = {m.name.removeprefix('./'): m for m in archive.getmembers() if m.isfile()}
            files = {name: archive.extractfile(members[name]).read() for name in expected if name in members}
    differences = []
    for name, source in expected.items():
        packed = files.get(name)
        if name == 'package.json' and packed is not None:
            if json.loads(packed) == json.loads(source):
                continue
        if packed != source:
            differences.append(name)
    return differences


def main():
    report = {'project': PROJECT, 'reviewCommit': command(['git', 'rev-parse', 'HEAD']),
              'readOnly': True, 'matchedFunctions': [], 'blockedFunctions': [],
              'mismatchedFunctions': [], 'dependenciesAndRuntimeNotAttested': True}
    try:
        if command(['gcloud', 'config', 'get-value', 'project']) != PROJECT or command([
            'gcloud', 'projects', 'describe', PROJECT, '--format=value(projectNumber)']) != NUMBER:
            raise ValueError('STAGING_PROJECT_IDENTITY_MISMATCH')
        names = json.loads((ROOT / 'scripts/paystack_function_manifest.json').read_text())
        expected = {p.name: p.read_bytes() for p in (ROOT / 'functions').glob('*.js')}
        pkg = json.loads((ROOT / 'functions/package.json').read_text())
        pkg['main'] = 'staging-index.generated.cjs'
        expected['package.json'] = json.dumps(pkg).encode()
        expected[pkg['main']] = command(['node', '-e',
            "process.stdout.write(require('./scripts/prepare_staging_function_scope.cjs').renderEntry(require('./scripts/paystack_function_manifest.json')))"]).encode() + b'\n'
        # command() trims the generated wrapper's final newline; restore it.
        inventory = json.loads(command(['gcloud', 'functions', 'list', '--v2',
            '--regions=us-central1', '--project=' + PROJECT,
            '--format=json(name,state,buildConfig.sourceProvenance.resolvedStorageSource,buildConfig.entryPoint)']))
        by_name = {item['name'].split('/')[-1]: item for item in inventory}
        token = command(['gcloud', 'auth', 'print-access-token'])
        cache = {}
        for name in names:
            item = by_name.get(name, {})
            src = item.get('buildConfig', {}).get('sourceProvenance', {}).get('resolvedStorageSource', {})
            bucket, obj, generation = (str(src.get(k, '')) for k in ('bucket', 'object', 'generation'))
            if item.get('state') != 'ACTIVE' or not bucket or not obj or not generation:
                report['blockedFunctions'].append({'name': name, 'reason': 'IMMUTABLE_BUILD_SOURCE_UNAVAILABLE'})
                continue
            if NUMBER not in bucket and PROJECT not in bucket:
                report['blockedFunctions'].append({'name': name, 'reason': 'SOURCE_BUCKET_NOT_STAGING'})
                continue
            key = (bucket, obj, generation)
            if key not in cache:
                route = ('https://storage.googleapis.com/storage/v1/b/' + urllib.parse.quote(bucket, safe='') +
                         '/o/' + urllib.parse.quote(obj, safe='') + '?' +
                         urllib.parse.urlencode({'alt': 'media', 'generation': generation}))
                try:
                    request = urllib.request.Request(route, headers={'Authorization': 'Bearer ' + token})
                    with urllib.request.urlopen(request, timeout=30) as response:
                        data = response.read(80 * 1024 * 1024 + 1)
                    if len(data) > 80 * 1024 * 1024:
                        raise ValueError('ARCHIVE_SIZE_LIMIT')
                    cache[key] = {'differences': compare_archive(data, expected),
                                  'archiveSha256': hashlib.sha256(data).hexdigest()}
                except urllib.error.HTTPError as error:
                    cache[key] = {'blocked': 'SOURCE_READ_HTTP_' + str(error.code)}
                except Exception:
                    cache[key] = {'blocked': 'SOURCE_ARCHIVE_READ_FAILED'}
            result = cache[key]
            if 'blocked' in result:
                report['blockedFunctions'].append({'name': name, 'reason': result['blocked']})
            elif result['differences']:
                report['mismatchedFunctions'].append({'name': name, 'files': result['differences']})
            else:
                report['matchedFunctions'].append(name)
        report['uniqueBuildArchives'] = len(cache)
        report['reviewedCodeFilesPerArchive'] = len(expected)
        report['reviewedFunctionCodeMatches'] = len(report['matchedFunctions']) == len(names) == 37
    except Exception as error:
        report['blocked'] = str(error) if isinstance(error, ValueError) else 'SOURCE_AUDIT_UNAVAILABLE'
        report['reviewedFunctionCodeMatches'] = False
    output = ROOT / 'source-readback'
    output.mkdir(exist_ok=True)
    (output / 'staging-function-source.json').write_text(json.dumps(report, indent=2) + '\n')
    print('STAGING_FUNCTION_CODE: MATCH=' + str(len(report['matchedFunctions'])) + '/37')
    print('BLOCKED=' + str(len(report['blockedFunctions'])) + ' MISMATCH=' + str(len(report['mismatchedFunctions'])))
    if 'blocked' in report:
        print('AUDIT_BLOCKED: ' + report['blocked'])
    for item in report['blockedFunctions']:
        print('SOURCE_CHECK: ' + item['name'] + '=' + item['reason'])
    for item in report['mismatchedFunctions']:
        print('SOURCE_CHECK: ' + item['name'] + '=DIFFERENT_REVIEWED_FILES:' + ','.join(item['files']))
    print('Read-only: no deployments, customer data, IAM changes or payments.')
    return 0 if report['reviewedFunctionCodeMatches'] else 2


if __name__ == '__main__':
    raise SystemExit(main())
