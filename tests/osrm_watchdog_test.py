"""Run with python3 tests/osrm_watchdog_test.py on Linux; no Docker required."""
import os
from pathlib import Path
import subprocess
import tempfile
import unittest

SCRIPT = Path(__file__).resolve().parents[1] / "docker" / "osrm-supervise.sh"


class WatchdogTest(unittest.TestCase):
    def run_supervisor(self, router, probe):
        with tempfile.TemporaryDirectory() as directory:
            for name, body in {
                "osrm-routed": router,
                "timeout": probe,
                "sleep": "exec /bin/sleep 0.02",
            }.items():
                path = Path(directory) / name
                path.write_text("#!/bin/bash\n" + body + "\n")
                path.chmod(0o755)
            env = {**os.environ, "PATH": directory + ":" + os.environ["PATH"],
                   "OSRM_WATCHDOG_START_SECONDS": "0"}
            return subprocess.run(["bash", str(SCRIPT)], env=env,
                                  capture_output=True, text=True, timeout=5)

    def test_stalled_router_exits_for_docker_restart(self):
        result = self.run_supervisor("exec /bin/sleep 100", "exit 1")
        self.assertEqual(result.returncode, 143, result.stderr)
        self.assertIn("probe failed (3/3)", result.stderr)
        self.assertIn("exiting for Docker recovery", result.stderr)

    def test_router_failure_is_propagated(self):
        result = self.run_supervisor("/bin/sleep 0.1; exit 7", "exit 0")
        self.assertEqual(result.returncode, 7, result.stderr)
        self.assertNotIn("probe failed", result.stderr)


if __name__ == "__main__":
    unittest.main()
