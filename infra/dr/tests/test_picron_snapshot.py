"""The picron snapshot in backup must copy a live WAL database consistently."""
from pathlib import Path
import sqlite3
import subprocess
import sys
import tempfile
import unittest

DR = Path(__file__).parents[1]
SCRIPT = (DR / "backup").read_text()
_, _, rest = SCRIPT.partition("<<'PY'\n")
SNAPSHOT, found, _ = rest.partition("\nPY\n")
assert found, "backup no longer embeds the picron snapshot program"


class PicronSnapshotTests(unittest.TestCase):
    def test_uncheckpointed_wal_rows_reach_the_snapshot(self):
        with tempfile.TemporaryDirectory() as work:
            live = Path(work) / "picron.db"
            writer = sqlite3.connect(live)
            writer.execute("PRAGMA journal_mode=WAL")
            writer.execute("PRAGMA wal_autocheckpoint=0")
            writer.execute("CREATE TABLE jobs (id TEXT PRIMARY KEY, name TEXT)")
            writer.executemany("INSERT INTO jobs VALUES (?, ?)", [(str(i), f"job {i}") for i in range(50)])
            writer.commit()
            self.assertTrue((Path(work) / "picron.db-wal").stat().st_size > 0)

            target = Path(work) / "snapshot.db"
            result = subprocess.run([sys.executable, "-I", "-", str(live), str(target)],
                                    input=SNAPSHOT, text=True, capture_output=True)
            self.assertEqual(result.returncode, 0, result.stderr)
            copy = sqlite3.connect(target)
            self.assertEqual(copy.execute("SELECT count(*) FROM jobs").fetchone()[0], 50)
            copy.close()
            writer.close()

    def test_allowlist_and_restore_carry_every_picron_piece(self):
        allowlist = (DR / "config" / "pi.allowlist").read_text()
        for path in ("/usr/local/bin/picron", "/etc/picron", "/etc/systemd/system/picron.service",
                     "/var/lib/picron/snapshot"):
            self.assertIn(f"\n{path}|optional|", allowlist)
        restore = (DR / "remote" / "restore-pi").read_text()
        self.assertIn("/var/lib/picron/snapshot/picron.db /var/lib/picron/picron.db", restore)
        self.assertIn("systemctl enable --now picron.service", restore)


if __name__ == "__main__":
    unittest.main()
