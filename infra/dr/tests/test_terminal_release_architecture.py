from pathlib import Path
import os
import re
import subprocess
import tempfile
import textwrap
import unittest


class TerminalReleaseArchitectureTests(unittest.TestCase):
    def test_release_selects_native_bundle_and_rejects_unsupported_hosts(self):
        root = Path(__file__).resolve().parents[3]
        workflow = (root / '.github/workflows/release-cloud-terminal.yml').read_text()
        selector = re.search(r'^          case "\$\(uname -m\)" in\n.*?^          esac$',
                             workflow, re.M | re.S)
        self.assertIsNotNone(selector)
        self.assertIn('cd "/usr/local/lib/deniz-cloud/$host_arch"', workflow)
        script = textwrap.dedent(selector.group()) + '\nprintf "%s" "$host_arch"\n'
        with tempfile.TemporaryDirectory() as temporary:
            uname = Path(temporary) / 'uname'
            uname.write_text('#!/bin/sh\nprintf "%s\\n" "$TEST_MACHINE"\n')
            uname.chmod(0o755)
            for machine, expected in [('x86_64', 'amd64'), ('aarch64', 'arm64'), ('riscv64', None)]:
                with self.subTest(machine=machine):
                    result = subprocess.run(['bash', '-eu', '-c', script], text=True,
                                            capture_output=True, env={**os.environ,
                                                'PATH': temporary + ':' + os.environ['PATH'],
                                                'TEST_MACHINE': machine})
                    if expected:
                        self.assertEqual(result.returncode, 0, result.stderr)
                        self.assertEqual(result.stdout, expected)
                    else:
                        self.assertNotEqual(result.returncode, 0)
                        self.assertEqual(result.stdout, '')


if __name__ == '__main__':
    unittest.main()
