import copy
import importlib.util
from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[3]
spec = importlib.util.spec_from_file_location('mounts', ROOT / 'infra/scripts/check-database-mounts.py')
mounts = importlib.util.module_from_spec(spec)
spec.loader.exec_module(mounts)


class DatabaseMountTests(unittest.TestCase):
    def fixtures(self):
        config = {'services': {}}
        current = {}
        for service, target in mounts.DATA_TARGETS.items():
            source = '/srv/deniz-dr/pi/' + service
            config['services'][service] = {'volumes': [{'type': 'bind', 'source': source, 'target': target}]}
            current[service] = [{'Mounts': [{'Type': 'bind', 'Source': source, 'Destination': target}]}]
        return config, current

    def test_existing_recovered_data_is_accepted(self):
        config, current = self.fixtures()
        self.assertEqual(mounts.validate(config, current), 5)

    def test_pi_defaults_cannot_replace_recovered_data(self):
        for service in mounts.DATA_TARGETS:
            with self.subTest(service=service):
                config, current = self.fixtures()
                config['services'][service]['volumes'][0]['source'] = '/mnt/ssd/' + service
                with self.assertRaisesRegex(ValueError, 'would change'):
                    mounts.validate(config, current)

    def test_missing_container_or_mount_fails_closed(self):
        for missing in ['container', 'mount', 'volume', 'bind']:
            with self.subTest(missing=missing):
                config, current = self.fixtures()
                if missing == 'container':
                    current['postgres'] = []
                elif missing == 'mount':
                    current['postgres'][0]['Mounts'] = []
                elif missing == 'volume':
                    config['services']['postgres']['volumes'] = []
                else:
                    config['services']['postgres']['volumes'][0]['type'] = 'volume'
                with self.assertRaises(ValueError):
                    mounts.validate(config, current)

    def test_every_container_for_a_service_must_match(self):
        config, current = self.fixtures()
        extra = copy.deepcopy(current['postgres'][0])
        extra['Mounts'][0]['Source'] = '/wrong'
        current['postgres'].append(extra)
        with self.assertRaises(ValueError):
            mounts.validate(config, current)


if __name__ == '__main__':
    unittest.main()
