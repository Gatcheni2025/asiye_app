import io
import zipfile
import unittest
from scripts.audit_staging_auth_function_source import verify_inventory, PROJECT, NUMBER


class AuthSourceResumeTests(unittest.TestCase):
    names = ['first', 'second', 'third', 'fourth', 'fifth', 'sixth', 'seventh']
    expected = {'index.js': b'reviewed code', 'package.json': b'{"main":"staging-index.generated.cjs"}'}

    def inventory(self):
        return [{'name': f'projects/{PROJECT}/locations/us-central1/functions/{name}',
                 'state': 'ACTIVE', 'buildConfig': {'runtime': 'nodejs22', 'entryPoint': name,
                 'sourceProvenance': {'resolvedStorageSource': {
                     'bucket': 'gcf-v2-sources-' + NUMBER + '-us-central1',
                     'object': 'reviewed/source.zip', 'generation': '123'}}}}
                for name in self.names]

    def archive(self, stale=False):
        output = io.BytesIO()
        with zipfile.ZipFile(output, 'w') as archive:
            for name, value in self.expected.items():
                archive.writestr(name, b'old code' if stale and name == 'index.js' else value)
            archive.writestr('.env', 'PRIVATE values must never be read or reported')
        return output.getvalue()

    def test_seven_active_exact_builds_match_and_shared_source_downloaded_once(self):
        calls = []
        def read(*key):
            calls.append(key)
            return self.archive()
        report = verify_inventory(self.inventory(), self.names, self.expected, read)
        self.assertTrue(report['ok'])
        self.assertEqual(report['matched'], self.names)
        self.assertEqual(len(calls), 1)
        self.assertEqual(calls[0][2], '123')
        self.assertNotIn('PRIVATE', str(report))

    def test_stale_code_missing_function_and_storage_read_denial_cannot_resume(self):
        report = verify_inventory(self.inventory(), self.names, self.expected, lambda *args: self.archive(stale=True))
        self.assertFalse(report['ok'])
        self.assertEqual(len(report['mismatched']), 7)
        self.assertEqual(report['mismatched'][0]['files'], ['index.js'])
        report = verify_inventory(self.inventory()[1:], self.names, self.expected, lambda *args: self.archive())
        self.assertFalse(report['ok'])
        self.assertEqual(report['blocked'][0]['name'], 'first')
        def denied(*args):
            raise PermissionError('private diagnostic must not be printed')
        report = verify_inventory(self.inventory(), self.names, self.expected, denied)
        self.assertFalse(report['ok'])
        self.assertNotIn('private diagnostic', str(report))

    def test_mutable_source_nonactive_build_or_wrong_project_cannot_resume(self):
        for mutate in (lambda x: x.update(state='DEPLOYING'),
                       lambda x: x['buildConfig']['sourceProvenance']['resolvedStorageSource'].pop('generation'),
                       lambda x: x['buildConfig']['sourceProvenance']['resolvedStorageSource'].update(bucket='production-source-bucket'),
                       lambda x: x.update(name='projects/asiye-80386/locations/us-central1/functions/first')):
            inventory = self.inventory()
            mutate(inventory[0])
            report = verify_inventory(inventory, self.names, self.expected, lambda *args: self.archive())
            self.assertFalse(report['ok'])
            self.assertEqual(report['blocked'][0]['name'], 'first')


if __name__ == '__main__':
    unittest.main()
