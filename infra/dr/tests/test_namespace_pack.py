import hashlib
import importlib.util
import os
from pathlib import Path
import sys
import tarfile
import tempfile
import unittest

SCRIPT = Path(__file__).parents[1] / 'lib/pack-namespace.py'
spec = importlib.util.spec_from_file_location('namespace_pack', SCRIPT)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


@unittest.skipUnless(sys.platform == 'linux', 'Linux hole-punching filesystem required')
class NamespacePackTests(unittest.TestCase):
    def test_consumed_archive_roundtrips_exact_bytes_and_names(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            source = root / 'source'
            source.mkdir()
            (source / 'meta').mkdir()
            expected = {'ssd.tar': os.urandom(module.CHUNK * 2 + 113),
                        'meta/manifest.jsonl': b'{"file":"example"}\n', 'empty': b''}
            for name, data in expected.items():
                (source / name).write_bytes(data)
            output = root / 'namespace.tar'
            module.pack(source, output)
            self.assertEqual(output.stat().st_mode & 0o777, 0o600)
            with tarfile.open(output) as archive:
                for name, data in expected.items():
                    self.assertEqual(hashlib.sha256(archive.extractfile('./' + name).read()).digest(),
                                     hashlib.sha256(data).digest())
                    self.assertFalse((source / name).exists())

    def test_rejects_links_before_consuming_any_source(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            source = root / 'source'
            source.mkdir()
            (source / 'data').write_bytes(b'keep')
            (source / 'link').symlink_to('data')
            with self.assertRaises(ValueError):
                module.pack(source, root / 'namespace.tar')
            self.assertEqual((source / 'data').read_bytes(), b'keep')

if __name__ == '__main__':
    unittest.main()
