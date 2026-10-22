import io
import json
import tarfile
import unittest
import zipfile
from scripts.audit_staging_function_source import compare_archive


class StagingSourceReadbackTests(unittest.TestCase):
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
