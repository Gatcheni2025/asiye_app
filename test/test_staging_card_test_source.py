import io
import json
from pathlib import Path
import unittest
import urllib.error
import zipfile
from scripts.audit_staging_admin_function_source import download_gen1_version, verify_inventory, PROJECT, NUMBER


class MixedCardTestSourceTests(unittest.TestCase):
    names = json.loads(Path('scripts/staging_card_test_functions.json').read_text())
    gen1 = 'synchronizeClubBooking'
    build = f'projects/{NUMBER}/locations/us-central1/builds/deployed-club-build'
    expected = {'index.js': b'reviewed code', 'package.json': b'{"main":"staging-index.generated.cjs"}',
                'staging-index.generated.cjs': b'reviewed staging entrypoint'}

    def inventory(self):
        rows = []
        for name in self.names:
            row = {'name': f'projects/{PROJECT}/locations/us-central1/functions/{name}',
                   'state': 'ACTIVE', 'environment': 'GEN_1' if name == self.gen1 else 'GEN_2'}
            if name != self.gen1:
                row['buildConfig'] = {'runtime': 'nodejs22', 'entryPoint': name,
                    'sourceProvenance': {'resolvedStorageSource': {
                        'bucket': 'gcf-v2-sources-' + NUMBER, 'object': 'current.zip', 'generation': '234'}}}
            rows.append(row)
        return rows

    def legacy(self):
        return {'name': f'projects/{PROJECT}/locations/us-central1/functions/{self.gen1}',
                'status': 'ACTIVE', 'runtime': 'nodejs22', 'entryPoint': self.gen1,
                'buildName': self.build, 'versionId': '17'}

    def build_metadata(self):
        return {'status': 'SUCCESS', 'sourceProvenance': {'resolvedStorageSource': {
            'bucket': 'gcf-sources-' + NUMBER, 'object': 'current.zip', 'generation': '123'}}}

    def metadata(self, legacy=None, build=None, calls=None):
        legacy = self.legacy() if legacy is None else legacy
        build = self.build_metadata() if build is None else build
        def get_json(url):
            if calls is not None:
                calls.append(url)
            if url.startswith('https://cloudfunctions.googleapis.com/v1/projects/' + PROJECT + '/'):
                self.assertIn('/functions/' + self.gen1 + '?fields=', url)
                return legacy
            self.assertTrue(url.startswith('https://cloudbuild.googleapis.com/v1/' + self.build + '?fields='))
            return build
        return get_json

    def archive(self, stale=False):
        out = io.BytesIO()
        with zipfile.ZipFile(out, 'w') as archive:
            for name, value in self.expected.items():
                archive.writestr(name, b'old deployed handler' if stale and name == 'index.js' else value)
            archive.writestr('.env', b'PRIVATE_RUNTIME_CREDENTIALS_MUST_NOT_BE_READ')
        return out.getvalue()

    def verify(self, **kwargs):
        return verify_inventory(kwargs.pop('inventory', self.inventory()), self.names, self.expected,
                                kwargs.pop('read_archive', lambda *args: self.archive()),
                                kwargs.pop('get_json', self.metadata()), **kwargs)

    def test_screenshot_22_of_23_is_reproduced_without_gen1_metadata_then_all_sources_are_verified(self):
        old = self.verify(get_json=None)
        self.assertEqual(len(old['matched']), 22)
        self.assertEqual(old['blocked'], [{'name': self.gen1, 'reason': 'GEN1_BUILD_METADATA_READER_UNAVAILABLE'}])
        reads, metadata_calls = [], []
        def read(*key):
            reads.append(key)
            return self.archive()
        report = self.verify(read_archive=read, get_json=self.metadata(calls=metadata_calls))
        self.assertTrue(report['ok'])
        self.assertEqual(len(report['matched']), 23)
        self.assertEqual(len(reads), 2, 'Shared Gen2 archive and immutable Gen1 archive are cached separately')
        self.assertEqual(len(metadata_calls), 2, 'Only the known Gen1 trigger needs v1 function and Cloud Build metadata')
        self.assertNotIn('PRIVATE', str(report))
        self.assertNotIn('environmentVariables', ''.join(metadata_calls))

    def test_gen1_old_or_wrong_code_still_blocks_hosting(self):
        report = self.verify(read_archive=lambda bucket, *args: self.archive(stale=bucket.startswith('gcf-sources-')))
        self.assertFalse(report['ok'])
        self.assertEqual(report['mismatched'], [{'name': self.gen1, 'files': ['index.js']}])

    def test_gen1_requires_active_pinned_function_correct_runtime_and_entrypoint(self):
        for patch in ({'status': 'DEPLOYING'}, {'runtime': 'nodejs20'}, {'entryPoint': 'anotherHandler'},
                      {'name': f'projects/asiye-80386/locations/us-central1/functions/{self.gen1}'}):
            with self.subTest(patch=patch):
                report = self.verify(get_json=self.metadata(legacy={**self.legacy(), **patch}))
                self.assertFalse(report['ok'])
                self.assertEqual(len(report['blocked']), 1)

    def test_gen1_needs_successful_staging_build_and_frozen_source_generation(self):
        for status in ('WORKING', 'FAILURE', 'CANCELLED'):
            self.assertFalse(self.verify(get_json=self.metadata(build={**self.build_metadata(), 'status': status}))['ok'])
        legacy = {**self.legacy(), 'buildName': 'projects/asiye-80386/locations/us-central1/builds/prod-build'}
        report = self.verify(get_json=self.metadata(legacy=legacy))
        self.assertEqual(report['blocked'][0]['reason'], 'GEN1_BUILD_NOT_IN_PINNED_PROJECT_REGION')
        for generation in (None, '', 'latest', '0'):
            build = self.build_metadata()
            build['sourceProvenance']['resolvedStorageSource']['generation'] = generation
            self.assertFalse(self.verify(get_json=self.metadata(build=build))['ok'])
        build = self.build_metadata()
        build['sourceProvenance']['resolvedStorageSource']['bucket'] = 'production-code-bucket'
        self.assertEqual(self.verify(get_json=self.metadata(build=build))['blocked'][0]['reason'], 'SOURCE_BUCKET_NOT_STAGING')

    def test_nonactive_listing_or_unexpected_generation_is_not_overridden_by_gen1_fallback(self):
        for patch in ({'state': 'DEPLOYING'}, {'environment': 'GEN_2'}):
            inventory = self.inventory()
            next(row for row in inventory if row['name'].endswith('/' + self.gen1)).update(patch)
            report = self.verify(inventory=inventory)
            self.assertFalse(report['ok'])

    def test_gen2_keeps_its_own_immutable_provenance_requirement(self):
        for patch in ({'generation': None}, {'generation': '0'}, {'generation': ''}):
            inventory = self.inventory()
            inventory[0]['buildConfig']['sourceProvenance']['resolvedStorageSource'].update(patch)
            report = self.verify(inventory=inventory)
            self.assertFalse(report['ok'])
            self.assertEqual(report['blocked'][0]['name'], self.names[0])

    def test_metadata_http_denial_has_a_safe_diagnostic_and_does_not_pass(self):
        def denied(url):
            raise urllib.error.HTTPError(url, 403, 'PRIVATE_AUTH_DETAIL', {}, None)
        report = self.verify(get_json=denied)
        self.assertFalse(report['ok'])
        self.assertEqual(report['blocked'][0]['reason'], 'BUILD_METADATA_HTTP_403')
        self.assertNotIn('PRIVATE_AUTH_DETAIL', str(report))

    def generationless_build(self):
        return {'status': 'SUCCESS', 'source': {'storageSource': {
            'bucket': 'gcf-sources-' + NUMBER, 'object': 'mutable-current.zip'}}}

    def version_download(self, stale=False, current=None, url=None, error=None, calls=None):
        current = self.legacy() if current is None else current
        url = 'https://storage.googleapis.com/google-managed-source/version-17.zip?Signature=PRIVATE' if url is None else url
        def open_url(request, timeout):
            if calls is not None:
                calls.append(request)
            if request.get_method() == 'POST':
                return io.BytesIO(json.dumps({'downloadUrl': url}).encode())
            if error:
                raise error
            return io.BytesIO(self.archive(stale))
        def read(name, version):
            return download_gen1_version(name, version, 'PRIVATE_OAUTH_TOKEN',
                lambda _: current, open_url)
        return read

    def test_screenshot_generationless_gen1_build_matches_only_with_exact_version_download(self):
        calls = []
        report = self.verify(get_json=self.metadata(build=self.generationless_build()),
                             read_version_archive=self.version_download(calls=calls))
        self.assertTrue(report['ok'])
        self.assertEqual(len(report['matched']), 23)
        self.assertEqual(len(calls), 2)
        self.assertEqual(calls[0].full_url, f'https://cloudfunctions.googleapis.com/v1/projects/{PROJECT}/locations/us-central1/functions/{self.gen1}:generateDownloadUrl')
        self.assertEqual(json.loads(calls[0].data), {'versionId': '17'})
        self.assertEqual(calls[0].get_header('Authorization'), 'Bearer PRIVATE_OAUTH_TOKEN')
        self.assertIsNone(calls[1].get_header('Authorization'), 'OAuth must never be forwarded to the signed URL')
        self.assertNotIn('PRIVATE', str(report))

    def test_version_pinned_download_still_compares_code_package_and_generated_entrypoint(self):
        report = self.verify(get_json=self.metadata(build=self.generationless_build()),
                             read_version_archive=self.version_download(stale=True))
        self.assertFalse(report['ok'])
        self.assertEqual(report['mismatched'], [{'name': self.gen1, 'files': ['index.js']}])
        for changed in ('package.json', 'staging-index.generated.cjs'):
            expected = {**self.expected, changed: b'{"main":"old.js"}' if changed == 'package.json' else b'old entrypoint'}
            report = verify_inventory(self.inventory(), self.names, expected, lambda *args: self.archive(),
                self.metadata(build=self.generationless_build()), self.version_download())
            self.assertFalse(report['ok'])
            self.assertIn({'name': self.gen1, 'files': [changed]}, report['mismatched'])

    def test_no_version_or_reader_never_substitutes_a_mutable_storage_object(self):
        report = self.verify(get_json=self.metadata(build=self.generationless_build()))
        self.assertEqual(report['blocked'], [{'name': self.gen1, 'reason': 'GEN1_VERSION_SOURCE_READER_UNAVAILABLE'}])
        for version in (None, '', '0', 'latest', '-1', '17.0'):
            calls = []
            report = self.verify(get_json=self.metadata(legacy={**self.legacy(), 'versionId': version},
                build=self.generationless_build()), read_version_archive=self.version_download(calls=calls))
            self.assertFalse(report['ok'])
            self.assertEqual(report['blocked'][0]['reason'], 'GEN1_DEPLOYED_VERSION_UNAVAILABLE')
            self.assertEqual(calls, [])

    def test_deployment_change_during_version_download_cannot_pass(self):
        for patch, reason in (({'versionId': '18'}, 'GEN1_DEPLOYMENT_CHANGED_DURING_AUDIT'),
                              ({'status': 'DEPLOY_IN_PROGRESS'}, 'GEN1_ACTIVE_REVIEWED_RUNTIME_OR_ENTRYPOINT_UNAVAILABLE'),
                              ({'runtime': 'nodejs20'}, 'GEN1_ACTIVE_REVIEWED_RUNTIME_OR_ENTRYPOINT_UNAVAILABLE'),
                              ({'name': f'projects/production/locations/us-central1/functions/{self.gen1}'},
                               'GEN1_ACTIVE_REVIEWED_RUNTIME_OR_ENTRYPOINT_UNAVAILABLE')):
            with self.subTest(patch=patch):
                report = self.verify(get_json=self.metadata(build=self.generationless_build()),
                    read_version_archive=self.version_download(current={**self.legacy(), **patch}))
                self.assertFalse(report['ok'])
                self.assertEqual(report['blocked'][0]['reason'], reason)

    def test_signed_download_is_google_storage_https_only_and_kept_out_of_diagnostics(self):
        for url in ('', 'http://storage.googleapis.com/a.zip', 'https://example.com/private.zip?Signature=PRIVATE',
                    'https://storage.googleapis.com.evil.test/a.zip', 'https://storage.googleapis.com@evil.test/a.zip',
                    'https://storage.googleapis.com:8443/a.zip', 'https://storage.googleapis.com/a.zip#PRIVATE'):
            calls = []
            report = self.verify(get_json=self.metadata(build=self.generationless_build()),
                read_version_archive=self.version_download(url=url, calls=calls))
            self.assertFalse(report['ok'])
            self.assertEqual(report['blocked'][0]['reason'], 'GEN1_SOURCE_DOWNLOAD_URL_INVALID')
            self.assertEqual(len(calls), 1, 'No request is sent to an invalid source URL')
            self.assertNotIn('PRIVATE', str(report))
        self.assertTrue(self.verify(get_json=self.metadata(build=self.generationless_build()),
            read_version_archive=self.version_download(url='https://managed-source.storage.googleapis.com/a.zip?Signature=PRIVATE'))['ok'])

    def test_version_source_denial_or_archive_failure_blocks_with_safe_reason(self):
        for error, reason in ((urllib.error.HTTPError('https://storage.googleapis.com/private?Signature=PRIVATE',
                                  403, 'PRIVATE_AUTH_DETAIL', {}, None), 'GEN1_VERSION_SOURCE_HTTP_403'),
                              (ValueError('PRIVATE_DOWNLOAD_DETAILS'), 'GEN1_VERSION_SOURCE_READ_FAILED'),
                              (ValueError('GEN1_SOURCE_DOWNLOAD_REDIRECT_BLOCKED'), 'GEN1_SOURCE_DOWNLOAD_REDIRECT_BLOCKED')):
            report = self.verify(get_json=self.metadata(build=self.generationless_build()),
                read_version_archive=self.version_download(error=error))
            self.assertFalse(report['ok'])
            self.assertEqual(report['blocked'][0]['reason'], reason)
            self.assertNotIn('PRIVATE', str(report))

    def test_download_helper_rejects_default_version_and_another_function_before_api_call(self):
        def forbidden(*args, **kwargs):
            self.fail('Invalid version/function must not contact the API')
        for name, version in ((self.gen1, '0'), (self.gen1, ''), ('prepareTripPayment', '17')):
            with self.assertRaisesRegex(ValueError, 'GEN1_DEPLOYED_VERSION_UNAVAILABLE'):
                download_gen1_version(name, version, 'PRIVATE', forbidden, forbidden)


if __name__ == '__main__':
    unittest.main()
