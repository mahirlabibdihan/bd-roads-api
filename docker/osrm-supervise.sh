#!/usr/bin/env bash
set -euo pipefail
osrm-routed "$@" &
router_pid=$!
watchdog_pid=
cleanup() {
  trap - EXIT TERM INT
  [[ -z "$watchdog_pid" ]] || kill "$watchdog_pid" 2>/dev/null || true
  kill -TERM "$router_pid" 2>/dev/null || true
  # Bound shutdown even when all OSRM workers are stuck computing.
  for ((i=0; i<5; i++)); do
    kill -0 "$router_pid" 2>/dev/null || break
    sleep 1
  done
  kill -KILL "$router_pid" 2>/dev/null || true
  wait "$router_pid" 2>/dev/null || true
}
trap cleanup EXIT
trap 'exit 143' TERM INT
(
  sleep "${OSRM_WATCHDOG_START_SECONDS:-60}"
  failures=0
  while kill -0 "$router_pid" 2>/dev/null; do
    if timeout 3 bash /opt/bpo/osrm-probe.sh; then
      failures=0
    else
      failures=$((failures + 1))
      echo "OSRM watchdog: probe failed ($failures/3)" >&2
      if ((failures >= 3)); then
        echo "OSRM watchdog: unresponsive; exiting for Docker recovery" >&2
        kill -TERM "$$"
        exit
      fi
    fi
    sleep 10
  done
) &
watchdog_pid=$!
wait "$router_pid"
