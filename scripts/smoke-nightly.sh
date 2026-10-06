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
# One log per run, never one per day: a second run the same day (a rerun by
# hand) once overwrote the night's log and took its evidence with it.
log="$STATE/$day-$(date +%H%M).log"
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

# The door, scripted (#925): a token minted by the operator's hand lets a
# script in with no password anywhere, and `chell -c` goes through the
# default door with no flags. Against this host's own porter (loopback, so
# a token may travel over plain http). Skipped, and said, while the
# installed porter is older than door tokens.
PORTER_BIN=${PORTER_BIN:-$HOME/.local/share/porter-published/node_modules/.bin/porter}
if [ -f "$HOME/.config/porter.env" ] && [ -x "$PORTER_BIN" ]; then
  set -a; . "$HOME/.config/porter.env"; set +a
  if "$PORTER_BIN" --tokens >/dev/null 2>&1; then
    door_log="$STATE/$day-door.log"
    (
      set -e
      export XDG_CONFIG_HOME="$P/config"
      # tag::door-login[]
      # The operator mints a token for the identity by hand; the plaintext is shown once and carried on stdin.
      "$PORTER_BIN" --mint "$E2E_USER" --name "nightly@$(hostname -s)" | sed -n 2p \
        | node packages/chell/dist/index.js auth login --door "http://127.0.0.1:${PORTER_PORT:-4180}" --with-token
      # From here no flags are needed: this door is the default for this config.
      node packages/chell/dist/index.js auth status
      node packages/chell/dist/index.js -c pwd
      node packages/chell/dist/index.js -e -c "cd /nowhere; pwd" || true   # -e stops at the first error
      node packages/chell/dist/index.js auth logout
      # end::door-login[]
    ) > "$door_log" 2>&1 && echo "$day  door  ok (mint, login by token, status, chell -c, -e, logout)" | tee -a "$ledger" \
      || { echo "$day  door  FAIL (see $door_log)" | tee -a "$ledger"; tail -5 "$door_log" | cut -c1-300 >> "$ledger"; }
  else
    echo "$day  door  skipped: the installed porter has no door tokens yet" | tee -a "$ledger"
  fi
fi
# The upgrade path (#915): a daemon on the previous published release, a
# porter from this checkout, two logins; one line in the ledger of its own.
bash "$ROOT/scripts/smoke-upgrade.sh" || true

echo "$day  log $log" >> "$ledger"
