import io
import json
import tarfile
import unittest
import zipfile
from scripts.audit_staging_function_source import compare_archive, immutable_source, PROJECT, NUMBER


class StagingSourceReadbackTests(unittest.TestCase):
    def test_gen1_uses_latest_successful_build_generation_and_stays_in_staging(self):
        calls = []
        build = 'projects/' + NUMBER + '/locations/us-central1/builds/test-build-1'
        source = {'bucket':'gcf-sources-' + NUMBER,'object':'source.zip','generation':'123'}
        def get_json(url):
            calls.append(url)
            if 'cloudfunctions.googleapis.com' in url:
                return {'status':'ACTIVE','buildName':build}
            return {'status':'SUCCESS','sourceProvenance':{'resolvedStorageSource':source}}
        self.assertEqual(immutable_source({}, 'synchronizeClubBooking', get_json), source)
        self.assertEqual(len(calls), 2)
        self.assertIn('projects/' + PROJECT + '/', calls[0])
        self.assertIn(build, calls[1])
        with self.assertRaisesRegex(ValueError, 'PINNED_PROJECT'):
            immutable_source({}, 'synchronizeClubBooking', lambda _: {
                'status':'ACTIVE','buildName':'projects/asiye-80386/locations/us-central1/builds/test-build-1'})

    def test_gen1_build_id_only_still_resolves_the_original_source_generation(self):
        calls=[]
        source={'bucket':'gcf-sources-' + NUMBER,'object':'source.zip','generation':'123'}
        def get_json(url):
            calls.append(url)
            if 'cloudfunctions.googleapis.com' in url:
                return {'status':'ACTIVE','buildId':'legacy-build-1'}
            return {'status':'SUCCESS','source':{'storageSource':source}}
        self.assertEqual(immutable_source({}, 'synchronizeClubBooking', get_json), source)
        self.assertIn('/builds/legacy-build-1?', calls[1])

    def test_gen2_resolved_source_needs_no_legacy_api_fallback(self):
        source = {'bucket':'gcf-sources-' + NUMBER,'object':'source.zip','generation':'123'}
        def forbidden(_):
            self.fail('Gen2 provenance must not make legacy metadata calls')
        self.assertEqual(immutable_source({'buildConfig':{'sourceProvenance':{'resolvedStorageSource':source}}},
            'prepareTripPayment', forbidden), source)

    def test_build_archive_comparison_accepts_json_reordering_but_detects_changed_code(self):
        expected = {'index.js': b'reviewed handler', 'package.json': b'{"main":"index.js","name":"functions"}'}
        for kind in ('zip', 'tar'):
            for stale in (False, True):
                files = {'index.js': b'old handler' if stale else expected['index.js'],
                         'package.json': b'{"name":"functions","main":"index.js"}',
                         '.env': b'private runtime values must never be extracted'}
                target = io.BytesIO()
                if kind == 'zip':
                    with zipfile.ZipFile(target, 'w') as archive:
                        for name, data in files.items():
                            archive.writestr(name, data)
                else:
                    with tarfile.open(fileobj=target, mode='w:gz') as archive:
                        for name, data in files.items():
                            member = tarfile.TarInfo('./' + name)
                            member.size = len(data)
                            archive.addfile(member, io.BytesIO(data))
                self.assertEqual(compare_archive(target.getvalue(), expected), ['index.js'] if stale else [])


if __name__ == '__main__':
    unittest.main()
