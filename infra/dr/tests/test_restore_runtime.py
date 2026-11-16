import json
import os
from pathlib import Path
import re
import subprocess
import sys
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[3]


class RestoreRuntimeTests(unittest.TestCase):
    def check_persistence(self, existing):
        source = (ROOT / 'infra/dr/remote/restore-pi').read_text()
        exports = source[source.index('export POSTGRES_DATA_DIR='):source.index('tailnet_ip=')]
        persistence = source[source.index('set_env_value() {'):source.index('terminal_env=')]
        services = {'postgres': 'POSTGRES_IMAGE', 'mongodb': 'MONGO_IMAGE',
                    'redis': 'REDIS_IMAGE', 'meilisearch': 'MEILI_IMAGE',
                    'mongot': 'MONGOT_IMAGE', 'docker-proxy': 'DOCKER_PROXY_IMAGE'}
        reference = 'example/image@sha256:' + 'a' * 64
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            env_file = root / 'pi.env'
            env_file.write_text(existing + 'API_IMAGE=release-controlled\nUNRELATED=preserved\n')
            manifest = root / 'manifest.json'
            manifest.write_text(json.dumps({'images': [
                {'service': 'pi/' + service, 'reference': reference}
                for service in [*services, 'api', 'mongo-init']]}))
            script = ('set -euo pipefail\n' + exports
                      + '\nAPI_TAILNET_BIND_ADDRESS=100.101.185.49\n'
                      + 'TERMINAL_SERVER_URL=ws://100.101.185.49:3003\n' + persistence)
            result = subprocess.run(['bash', '-c', script], capture_output=True, text=True,
                                    env={**os.environ, 'env_file': str(env_file), 'manifest': str(manifest)})
            self.assertEqual(result.returncode, 0, result.stderr)
            lines = env_file.read_text().splitlines()
            values = dict(line.split('=', 1) for line in lines)
            self.assertEqual(len(values), len(lines), 'duplicate environment keys')
            for key, value in re.findall(r'^export ([A-Z_]+)=(.+)$', exports, re.M):
                self.assertEqual(values[key], value)
            for key in services.values():
                self.assertEqual(values[key], reference)
            self.assertEqual(values['API_IMAGE'], 'release-controlled')
            self.assertEqual(values['UNRELATED'], 'preserved')
            self.assertEqual(values['API_TAILNET_BIND_ADDRESS'], '100.101.185.49')

    def test_fresh_shell_retains_all_recovery_paths_and_infrastructure_pins(self):
        self.check_persistence('')

    @unittest.skipUnless(sys.platform.startswith('linux'), 'restore uses GNU sed on Linux')
    def test_existing_home_paths_are_replaced_without_duplicate_keys(self):
        self.check_persistence('POSTGRES_DATA_DIR=/mnt/ssd/postgres\nMONGO_IMAGE=mongo:latest\n')


if __name__ == '__main__':
    unittest.main()
