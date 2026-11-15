import copy
import importlib.util
from pathlib import Path
import unittest

spec = importlib.util.spec_from_file_location('ttl_plan', Path(__file__).parents[1] / 'lib/mongo-ttl-plan.py')
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)

class TtlPlanTests(unittest.TestCase):
    def setUp(self):
        self.expected = {'databases': [{'name': 'app', 'collections': [{'name': 'events', 'documents': 10,
            'indexes': [{'name': 'ts_1', 'key': {'ts': 1}, 'expireAfterSeconds': 60}]}]}], 'users': [], 'roles': []}
        self.actual = copy.deepcopy(self.expected)
        self.actual['databases'][0]['collections'][0]['documents'] = 12

    def test_only_exact_ttl_excess_is_planned(self):
        result = module.plan(self.expected, self.actual, '2026-11-09T05:38:59Z')
        self.assertEqual(result['collections'][0]['before'], 12)
        self.assertEqual(result['collections'][0]['expected'], 10)
        self.assertEqual(self.actual['databases'][0]['collections'][0]['documents'], 12)

    def test_missing_documents_are_rejected(self):
        self.actual['databases'][0]['collections'][0]['documents'] = 9
        with self.assertRaises(ValueError): module.plan(self.expected, self.actual, 'timestamp')

    def test_roles_and_indexes_cannot_be_masked_by_ttl(self):
        for field in ('roles', 'index'):
            actual = copy.deepcopy(self.actual)
            if field == 'roles': actual['roles'] = ['unexpected']
            else: actual['databases'][0]['collections'][0]['indexes'][0]['expireAfterSeconds'] = 120
            with self.assertRaises(ValueError): module.plan(self.expected, actual, 'timestamp')

    def test_non_ttl_counts_are_rejected(self):
        self.expected['databases'][0]['collections'][0]['indexes'] = []
        self.actual['databases'][0]['collections'][0]['indexes'] = []
        with self.assertRaises(ValueError): module.plan(self.expected, self.actual, 'timestamp')

if __name__ == '__main__': unittest.main()
