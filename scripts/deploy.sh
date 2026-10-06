#!/usr/bin/env bash
# Deploy: publish what main holds and put it on the hosts, in the order that
# cannot leave a host empty.
#
#   make deploy                 publish via the Version Packages PR, then install
#   make deploy HOSTS=pangea    one host only (pangea | titan | "pangea titan")
#   make deploy SKIP_PUBLISH=1  the release is already on npm: install only
#
# Rules (2026-10-05, after a reinstall left both hosts empty for minutes):
#   1. every bumped package is verified on npm — the exact version — before any
#      install is touched; the registry lags the release run by a minute or two;
#   2. install before remove: never `npm uninstall` first; npm replaces the tree;
#   3. titan's root npm keeps its own packument cache: --prefer-online.
# The bumped packages are read from the Version Packages merge on main, so the
# list is never typed by hand.
set -euo pipefail
ROOT=$(cd "$(dirname "$0")/.." && pwd)
cd "$ROOT"
HOSTS=${HOSTS:-"pangea titan"}
SKIP_PUBLISH=${SKIP_PUBLISH:-}
PANGEA_PREFIX=${PANGEA_PREFIX:-$HOME/.local/share/porter-published}
TITAN=${TITAN:-titan}

say() { printf '[deploy] %s\n' "$*"; }
die() { printf '[deploy] FAIL: %s\n' "$*" >&2; exit 1; }

if [ -z "$SKIP_PUBLISH" ]; then
  pr=$(gh pr list --head changeset-release/main --state open --json number --jq '.[0].number')
  [ -n "$pr" ] || die "no open Version Packages PR: nothing to publish (merge the change first, or SKIP_PUBLISH=1 to install what npm has)"
  say "Version Packages PR #$pr: nudging its CI, then publishing"
  gh pr close "$pr" >/dev/null 2>&1 || true; sleep 5; gh pr reopen "$pr" >/dev/null 2>&1 || true; sleep 30
  make --no-print-directory publish 2>&1 | grep -vE '^\s*$|Waiting|^All checks' | tail -2
  sleep 60
  run=$(gh run list --workflow release.yml --limit 1 --json databaseId --jq '.[0].databaseId')
  gh run watch "$run" --exit-status >/dev/null 2>&1 || die "release run $run did not succeed"
  say "release run $run: success"
fi

git fetch -q origin && make --no-print-directory sync >/dev/null 2>&1 || true

# The packages the last Version Packages merge bumped, as workspace dirs.
bumped=$(git log -1 --first-parent --format=%H -- .changeset 2>/dev/null)
# A merge commit: diff against its first parent (git show prints nothing for a merge without -m).
dirs=$(git diff --name-only "$bumped^1" "$bumped" -- 'packages/*/package.json' 'apps/*/package.json' | xargs -rn1 dirname | sort -u)
[ -n "$dirs" ] || die "no package.json moved in the last Version Packages merge ($bumped)"

spec=""
for d in $dirs; do
  name=$(node -pe "require('./$d/package.json').name"); want=$(node -pe "require('./$d/package.json').version")
  got=""
  for _ in $(seq 1 40); do got=$(npm view "$name@$want" version --prefer-online 2>/dev/null || true); [ "$got" = "$want" ] && break; sleep 15; done
  [ "$got" = "$want" ] || die "$name@$want is not on npm yet; nothing installed"
  say "$name $want on npm"
  spec="$spec $name@$want"
done
pv=$(node -pe "require('./apps/porter/package.json').version")
say "porter $pv; installing:$spec"

for host in $HOSTS; do
  case "$host" in
    pangea)
      # Explicit versions beside porter (hoisted; porter resolves them); nothing removed first.
      npm install --prefix "$PANGEA_PREFIX" "@fnndsc/porter@$pv" $spec >/dev/null 2>&1 || die "pangea install failed; its tree is untouched"
      for p in argus brasa chell calypso porter; do printf '  pangea %-8s %s\n' "$p" "$(node -p "require('$PANGEA_PREFIX/node_modules/@fnndsc/$p/package.json').version")"; done
      systemctl --user restart porter && sleep 3 && say "pangea porter $(systemctl --user is-active porter)"
      ;;
    titan)
      # A global install replaces the tree, so root's npm must see every version first.
      ssh -o BatchMode=yes -o ConnectTimeout=15 "$TITAN" "for s in$spec @fnndsc/porter@$pv; do for i in \$(seq 1 40); do sudo -n npm view \$s version --prefer-online >/dev/null 2>&1 && break; sleep 15; done; done; sudo -n npm i -g @fnndsc/porter@$pv --prefer-online >/dev/null 2>&1 || { echo '[deploy] FAIL: titan install failed; its tree is kept'; exit 1; }; sudo -n systemctl restart porter && sleep 3 && echo \"[deploy] titan porter \$(systemctl is-active porter)\"; for p in argus brasa chell calypso; do printf '  titan  %-8s %s\n' \$p \"\$(node -p \"require('/usr/lib/node_modules/@fnndsc/porter/node_modules/@fnndsc/\$p/package.json').version\")\"; done; printf '  titan  %-8s %s\n' porter \"\$(node -p \"require('/usr/lib/node_modules/@fnndsc/porter/package.json').version\")\""
      ;;
    *) die "unknown host '$host' (pangea | titan)";;
  esac
done
say "done; sessions on old code restart once at their owner's next login"
