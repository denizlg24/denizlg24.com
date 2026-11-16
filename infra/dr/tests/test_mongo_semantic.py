from pathlib import Path
import json
import subprocess
import unittest


HARNESS = r'''
const fs = require("node:fs");
const vm = require("node:vm");
const views = Number(process.argv[2]);
const timeseries = Number(process.argv[3]);
const database = {
  adminCommand() { return {databases:[{name:"app"}]}; },
  runCommand(query) { return query.usersInfo ? {users:[]} : {roles:[]}; },
  getCollectionInfos(filter) {
    return typeof filter.type === "object" ? Array.from({length:views+timeseries}, (_,i)=>({name:"view"+i}))
      : [{name:"records"},{name:"system.views"}];
  },
  getCollection(name) {
    return {
      countDocuments() {
        if (name === "system.views") throw new Error("authenticated root cannot aggregate system.views");
        return 3;
      },
      getIndexes() { return [{name:"_id_",key:{_id:1}}]; }
    };
  }
};
vm.runInNewContext(fs.readFileSync(process.argv[1],"utf8"), {
  process:{env:{DR_MONGO_URI:"mongodb://fixture"}},
  Mongo:function(){return {getDB(){return database;}};},
  print(value){process.stdout.write(value);}
});
'''


class MongoSemanticAuthorizationTests(unittest.TestCase):
    def test_view_catalog_preserves_exact_counts_without_forbidden_reads(self):
        script = Path(__file__).parents[1] / "lib/mongo-semantic.js"
        for views, timeseries in ((0, 0), (2, 0), (0, 1), (2, 1)):
            with self.subTest(views=views, timeseries=timeseries):
                result = subprocess.run(["node", "-e", HARNESS, str(script), str(views), str(timeseries)],
                    text=True, capture_output=True, check=True)
                data = json.loads(result.stdout)
                counts = {c["name"]: c["documents"] for c in data["databases"][0]["collections"]}
                self.assertEqual(counts, {"records": 3, "system.views": views+timeseries})


if __name__ == "__main__":
    unittest.main()
