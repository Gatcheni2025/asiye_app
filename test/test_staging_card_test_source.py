import io
import json
from pathlib import Path
import unittest
import urllib.error
import zipfile
from scripts.audit_staging_admin_function_source import verify_inventory, PROJECT, NUMBER


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
                'status': 'ACTIVE', 'runtime': 'nodejs22', 'entryPoint': self.gen1, 'buildName': self.build}

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


if __name__ == '__main__':
    unittest.main()
