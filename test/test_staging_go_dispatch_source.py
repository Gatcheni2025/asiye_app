import io
import json
from pathlib import Path
import unittest
import zipfile
from scripts.audit_staging_admin_function_source import verify_inventory, PROJECT, NUMBER


class GoDispatchSourceTests(unittest.TestCase):
    names = json.loads(Path('scripts/go_dispatch_staging_functions.json').read_text())
    expected = {'index.js': b'reviewed category matching', 'package.json': b'{"main":"staging-index.generated.cjs"}'}

    def inventory(self):
        return [{'name': f'projects/{PROJECT}/locations/us-central1/functions/{name}',
                 'state': 'ACTIVE', 'buildConfig': {'runtime': 'nodejs22', 'entryPoint': name,
                 'sourceProvenance': {'resolvedStorageSource': {
                     'bucket': 'gcf-v2-sources-' + NUMBER + '-us-central1',
                     'object': 'reviewed/source.zip', 'generation': '123'}}}}
                for name in self.names]

    def archive(self, stale=False):
        out = io.BytesIO()
        with zipfile.ZipFile(out, 'w') as z:
            for name, content in self.expected.items():
                z.writestr(name, b'old matching filter' if stale and name == 'index.js' else content)
            z.writestr('.env', 'PRIVATE: must not be read or printed')
        return out.getvalue()

    def test_both_callers_require_the_exact_reviewed_source(self):
        calls = []
        def read(*key):
            calls.append(key)
            return self.archive()
        report = verify_inventory(self.inventory(), self.names, self.expected, read)
        self.assertTrue(report['ok'])
        self.assertEqual(len(calls), 1)
        self.assertNotIn('PRIVATE', str(report))
        stale = verify_inventory(self.inventory(), self.names, self.expected, lambda *args: self.archive(True))
        self.assertFalse(stale['ok'])
        self.assertEqual(len(stale['mismatched']), 2)

    def test_missing_wrong_project_mutable_or_nonactive_build_cannot_pass(self):
        self.assertFalse(verify_inventory(self.inventory()[1:], self.names, self.expected, lambda *args: self.archive())['ok'])
        for mutate in (lambda x: x.update(state='DEPLOYING'),
                       lambda x: x['buildConfig']['sourceProvenance']['resolvedStorageSource'].pop('generation'),
                       lambda x: x.update(name='projects/asiye-80386/locations/us-central1/functions/submitGoFareOffer')):
            inventory = self.inventory()
            mutate(inventory[0])
            self.assertFalse(verify_inventory(inventory, self.names, self.expected, lambda *args: self.archive())['ok'])


if __name__ == '__main__':
    unittest.main()
