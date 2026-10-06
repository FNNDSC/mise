#!/usr/bin/env bash
# The nightly: a fresh private daemon as the e2e identity, the whole ARGUS smoke
# against it at the desk width, then the listing stages again at a tablet width
# and under a finger, and one summary line appended to the ledger.
#
# A red here is a defect or a stale test, fixed the next day — never carried
# (epic #915). Read the ledger with `make smoke-report`.
#
# Needs: ~/.config/mise/e2e.env (E2E_USER, E2E_PASSWORD, E2E_CUBE) and a built
# repo (`make cook`); runs from a systemd user timer on pangea (mise-smoke.timer).
set -uo pipefail
ROOT=$(cd "$(dirname "$0")/.." && pwd)
cd "$ROOT"
STATE=${SMOKE_STATE:-$HOME/.local/state/mise/smoke}
P=${SMOKE_PRIVATE:-/tmp/pde2e-nightly}
mkdir -p "$STATE" "$P/tmp" "$P/run" "$P/config" "$P/cache" /tmp/smN
day=$(date +%F)
log="$STATE/$day.log"
ledger="$STATE/ledger.txt"

# A private daemon of our own: its own XDG dirs (cwd.txt and proc shards are per identity).
set -a; . "$HOME/.config/mise/e2e.env"; set +a
# The daemon logs in with the e2e identity's SAVED token, seeded from the
# config the e2e daemon keeps (SMOKE_SEED, default /tmp/pde2e/config): a
# password on a command line would show in every ps on this host.
SEED=${SMOKE_SEED:-/tmp/pde2e/config}
[ -d "$SEED/@fnndsc" ] || { echo "$day  no e2e seed at $SEED/@fnndsc: log the e2e identity in once (restart-e2e) and run again" | tee -a "$ledger"; exit 1; }
rm -rf "$P/config/@fnndsc" && cp -r "$SEED/@fnndsc" "$P/config/@fnndsc"
rm -f "$P"/run/calypso/berth-*.json
TMPDIR=$P/tmp XDG_RUNTIME_DIR=$P/run XDG_CONFIG_HOME=$P/config XDG_CACHE_HOME=$P/cache \
  setsid nohup node "$ROOT/packages/chell/dist/index.js" --daemon --no-logo --saved-token "$E2E_USER@$E2E_CUBE" > "$P/daemon.log" 2>&1 < /dev/null &
b=""; for _ in $(seq 1 180); do b=$(ls "$P/run/calypso/" 2>/dev/null | grep berth- | head -1); [ -n "$b" ] && break; sleep 1; done
[ -n "$b" ] || { echo "$day  no berth: the daemon did not boot" | tee -a "$ledger"; exit 1; }
url=$(python3 -c "import json,sys; d=json.load(open(sys.argv[1])); print(d['url'].replace('ws://','http://')+'/?token='+d['token'])" "$P/run/calypso/$b")
pid=$(python3 -c "import json,sys; print(json.load(open(sys.argv[1]))['pid'])" "$P/run/calypso/$b")

run() { # name, port, extra env…
  local name=$1 port=$2; shift 2
  # A fresh browser every run: the profile holds localStorage (sized columns,
  # the landing), and a run that inherits last night's remembers what the
  # scenarios expect a new device to have forgotten.
  rm -rf "/tmp/smN/$name"
  env "$@" TMPDIR=/tmp/smN ARGUS_URL="$url" SMOKE_CDP_PORT="$port" SMOKE_CHROME_FLAGS="--no-sandbox --user-data-dir=/tmp/smN/$name" \
    timeout 2700 node apps/argus/tests/smoke/smoke.mjs > "$log.$name" 2>&1
  local line; line=$(grep -E '^[0-9]+ ok' "$log.$name" | head -1 | cut -c1-400)
  echo "$day  $name  ${line:-no summary (crashed?)}" | tee -a "$ledger"
  grep -E '^\s+FAIL' "$log.$name" | cut -c1-300 >> "$ledger" || true
}
run desk 9701
run tablet 9702 SMOKE_ONLY=listing-columns,mode-frame,cards,runs-honesty,roster-order,notes SMOKE_WIDTH=1024 SMOKE_HEIGHT=768
run finger 9703 SMOKE_ONLY=listing-columns,mode-frame,cards,notes SMOKE_WIDTH=1024 SMOKE_HEIGHT=768 SMOKE_TOUCH=1
cat "$log".desk "$log".tablet "$log".finger > "$log" 2>/dev/null; rm -f "$log".desk "$log".tablet "$log".finger
kill "$pid" 2>/dev/null || true
echo "$day  log $log" >> "$ledger"
