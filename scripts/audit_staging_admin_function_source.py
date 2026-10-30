#!/usr/bin/env python3
"""Read-only source proof for selected staging functions before resuming Hosting."""
import json
from pathlib import Path
import re
import urllib.error
import urllib.parse
import urllib.request
try:
    from .audit_staging_function_source import compare_archive, immutable_source, command, ROOT, PROJECT, NUMBER
except ImportError:
    from audit_staging_function_source import compare_archive, immutable_source, command, ROOT, PROJECT, NUMBER


def gen1_deployment(name, get_json):
    base = ('https://cloudfunctions.googleapis.com/v1/projects/' + PROJECT +
            '/locations/us-central1/functions/' + name)
    legacy = get_json(base + '?fields=name,status,runtime,entryPoint,buildName,buildId,versionId')
    pinned_names = {f'projects/{p}/locations/us-central1/functions/{name}' for p in (PROJECT, NUMBER)}
    if (legacy.get('name') not in pinned_names or legacy.get('status') != 'ACTIVE' or
            legacy.get('runtime') != 'nodejs22' or legacy.get('entryPoint') != name):
        raise ValueError('GEN1_ACTIVE_REVIEWED_RUNTIME_OR_ENTRYPOINT_UNAVAILABLE')
    return base, legacy


def download_gen1_version(name, version_id, token, get_json, open_url=None):
    """Download the API's exact deployed version; keep the signed URL in memory."""
    if name != 'synchronizeClubBooking' or not re.fullmatch(r'[1-9][0-9]*', version_id):
        raise ValueError('GEN1_DEPLOYED_VERSION_UNAVAILABLE')
    if open_url is None:
        class NoRedirect(urllib.request.HTTPRedirectHandler):
            def redirect_request(self, req, fp, code, msg, headers, newurl):
                raise ValueError('GEN1_SOURCE_DOWNLOAD_REDIRECT_BLOCKED')
        open_url = urllib.request.build_opener(NoRedirect()).open
    base = ('https://cloudfunctions.googleapis.com/v1/projects/' + PROJECT +
            '/locations/us-central1/functions/' + name)
    request = urllib.request.Request(base + ':generateDownloadUrl',
        data=json.dumps({'versionId': version_id}).encode(), method='POST',
        headers={'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json'})
    with open_url(request, timeout=30) as response:
        payload = json.load(response)
    url = payload.get('downloadUrl', '')
    try:
        parsed = urllib.parse.urlsplit(url)
        host = parsed.hostname or ''
        valid = (parsed.scheme == 'https' and parsed.port in (None, 443) and
                 not parsed.username and not parsed.password and not parsed.fragment and
                 (host == 'storage.googleapis.com' or
                  (host.endswith('.storage.googleapis.com') and host != '.storage.googleapis.com')) and
                 bool(parsed.path.strip('/')))
    except (ValueError, TypeError):
        valid = False
    if not valid:
        raise ValueError('GEN1_SOURCE_DOWNLOAD_URL_INVALID')
    # The Google function endpoint binds this URL to the requested version.
    # It can use a Google-managed bucket; do not infer deployment identity from
    # its bucket name, substitute a mutable object, or forward the OAuth token.
    with open_url(urllib.request.Request(url), timeout=30) as response:
        data = response.read(80 * 1024 * 1024 + 1)
    if len(data) > 80 * 1024 * 1024:
        raise ValueError('ARCHIVE_SIZE_LIMIT')
    # get_json must make a fresh function GET here, rather than reuse its cache.
    _, current = gen1_deployment(name, get_json)
    if str(current.get('versionId', '')) != version_id:
        raise ValueError('GEN1_DEPLOYMENT_CHANGED_DURING_AUDIT')
    return data


def reviewed_source(item, name, get_json=None):
    pinned_names = {f'projects/{p}/locations/us-central1/functions/{name}' for p in (PROJECT, NUMBER)}
    if item.get('name') not in pinned_names or item.get('state') != 'ACTIVE':
        raise ValueError('ACTIVE_REVIEWED_BUILD_UNAVAILABLE')
    if name == 'synchronizeClubBooking':
        # This reviewed export is functions.database.onWrite (Gen1). Its
        # deployed version is described by v1; the v2 listing may omit both
        # BuildConfig entrypoint/runtime and resolved source provenance.
        if item.get('environment') == 'GEN_2':
            raise ValueError('REVIEWED_GEN1_TRIGGER_HAS_UNEXPECTED_GENERATION')
        if get_json is None:
            raise ValueError('GEN1_BUILD_METADATA_READER_UNAVAILABLE')
        base, legacy = gen1_deployment(name, get_json)
        def deployed_metadata(url):
            return legacy if url.partition('?')[0] == base else get_json(url)
        try:
            return immutable_source({}, name, deployed_metadata)
        except ValueError as error:
            if str(error) != 'GEN1_BUILD_SOURCE_GENERATION_UNAVAILABLE':
                raise
            # Some successful Gen1 builds expose no Storage generation. The
            # function API can still return source for its exact versionId.
            version = str(legacy.get('versionId', ''))
            if not re.fullmatch(r'[1-9][0-9]*', version):
                raise ValueError('GEN1_DEPLOYED_VERSION_UNAVAILABLE') from None
            return {'functionVersion': version}
    build = item.get('buildConfig', {})
    if (item.get('environment') == 'GEN_1' or build.get('entryPoint') != name or
            build.get('runtime') != 'nodejs22'):
        raise ValueError('ACTIVE_REVIEWED_BUILD_UNAVAILABLE')
    return build.get('sourceProvenance', {}).get('resolvedStorageSource', {})


def verify_inventory(inventory, names, expected, read_archive, get_json=None, read_version_archive=None):
    by_name = {item.get('name', '').split('/')[-1]: item for item in inventory}
    report = {'matched': [], 'blocked': [], 'mismatched': []}
    cache = {}
    for name in names:
        item = by_name.get(name, {})
        try:
            src = reviewed_source(item, name, get_json)
        except urllib.error.HTTPError as error:
            report['blocked'].append({'name': name, 'reason': 'BUILD_METADATA_HTTP_' + str(error.code)})
            continue
        except ValueError as error:
            report['blocked'].append({'name': name, 'reason': str(error)})
            continue
        except Exception:
            report['blocked'].append({'name': name, 'reason': 'BUILD_METADATA_READ_FAILED'})
            continue
        if 'functionVersion' in src:
            if read_version_archive is None:
                report['blocked'].append({'name': name, 'reason': 'GEN1_VERSION_SOURCE_READER_UNAVAILABLE'})
                continue
            try:
                differences = compare_archive(read_version_archive(name, src['functionVersion']), expected)
            except urllib.error.HTTPError as error:
                report['blocked'].append({'name': name, 'reason': 'GEN1_VERSION_SOURCE_HTTP_' + str(error.code)})
                continue
            except Exception as error:
                safe = {'GEN1_DEPLOYED_VERSION_UNAVAILABLE', 'GEN1_SOURCE_DOWNLOAD_URL_INVALID',
                        'GEN1_SOURCE_DOWNLOAD_REDIRECT_BLOCKED',
                        'GEN1_DEPLOYMENT_CHANGED_DURING_AUDIT',
                        'GEN1_ACTIVE_REVIEWED_RUNTIME_OR_ENTRYPOINT_UNAVAILABLE', 'ARCHIVE_SIZE_LIMIT'}
                reason = str(error) if isinstance(error, ValueError) and str(error) in safe else 'GEN1_VERSION_SOURCE_READ_FAILED'
                report['blocked'].append({'name': name, 'reason': reason})
                continue
            if differences:
                report['mismatched'].append({'name': name, 'files': differences})
            else:
                report['matched'].append(name)
            continue
        bucket, obj, generation = (str(src.get(k, '')) for k in ('bucket', 'object', 'generation'))
        if not bucket or not obj or not generation.isdecimal() or int(generation) < 1:
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
    report['ok'] = bool(names) and len(set(names)) == len(names) == len(report['matched'])
    return report


def main(manifest_path='scripts/staging_driver_admin_functions.json', label='STAGING_ADMIN_FUNCTION_SOURCE', include_selected_in_scope=False, full_review_scope=False):
    try:
        if (command(['gcloud', 'config', 'get-value', 'project']) != PROJECT or
                command(['gcloud', 'projects', 'describe', PROJECT, '--format=value(projectNumber)']) != NUMBER):
            raise ValueError('STAGING_PROJECT_IDENTITY_MISMATCH')
        names = json.loads((ROOT / manifest_path).read_text())
        expected = {p.name: p.read_bytes() for p in (ROOT / 'functions').glob('*.js')}
        pkg = json.loads((ROOT / 'functions/package.json').read_text())
        pkg['main'] = 'staging-index.generated.cjs'
        expected['package.json'] = json.dumps(pkg).encode()
        extra_scope = ',...require(' + json.dumps('./' + manifest_path) + ')' if include_selected_in_scope else ''
        generator = (
            "const names=[...new Set([...require('./scripts/paystack_function_manifest.json'),"
            "...require('./scripts/auth_booking_staging_functions.json'),...require('./scripts/staging_driver_admin_functions.json')" + extra_scope + "])];"
            "process.stdout.write(require('./scripts/prepare_staging_function_scope.cjs').renderEntry(names));")
        if full_review_scope:
            generator = "process.stdout.write(require('./scripts/prepare_staging_function_scope.cjs').renderEntry(require('./scripts/audit_347_staging_readonly.cjs').manifest()));"
        expected[pkg['main']] = command(['node', '-e', generator]).encode() + b'\n'
        inventory = json.loads(command(['gcloud', 'functions', 'list', '--v2', '--regions=us-central1',
            '--project=' + PROJECT,
            '--format=json(name,state,environment,buildConfig.runtime,buildConfig.entryPoint,buildConfig.sourceProvenance.resolvedStorageSource)']))
        token = command(['gcloud', 'auth', 'print-access-token'])
        metadata_cache = {}
        def get_json(url):
            # The Gen1 version download rechecks current deployment identity.
            # Only immutable Cloud Build metadata may be reused across reads.
            fresh = url.startswith('https://cloudfunctions.googleapis.com/v1/')
            if fresh or url not in metadata_cache:
                request = urllib.request.Request(url, headers={'Authorization': 'Bearer ' + token})
                with urllib.request.urlopen(request, timeout=30) as response:
                    metadata_cache[url] = json.load(response)
            return metadata_cache[url]
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
        report = verify_inventory(inventory, names, expected, read_archive, get_json,
            lambda name, version: download_gen1_version(name, version, token, get_json))
        print(label + ': MATCH=' + str(len(report['matched'])) + '/' + str(len(names)))
        for kind in ('blocked', 'mismatched'):
            for item in report[kind]:
                print('SOURCE_' + kind.upper() + ': ' + item['name'] + ' ' +
                      str(item.get('reason', ','.join(item.get('files', [])))))
        return 0 if report['ok'] else 2
    except Exception as error:
        print(label + ': BLOCKED ' +
              (str(error) if isinstance(error, ValueError) else 'READ_ONLY_SOURCE_CHECK_FAILED'))
        return 2


if __name__ == '__main__':
    raise SystemExit(main())
