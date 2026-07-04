# Exports every CUBE_* key of the gitignored exemplars/e2e.config.json
# into the environment. Source it (do not execute):
#
#   . exemplars/e2e-env.sh
#
# The TS exemplars read the config file themselves; this helper exists for
# the chell scripts and ad-hoc shell use, where only the environment is
# visible.

_e2e_config="$(dirname "${BASH_SOURCE:-$0}")/e2e.config.json"
if [ ! -f "$_e2e_config" ]; then
  echo "No $_e2e_config — copy e2e.config.example.json and fill it in." >&2
else
  eval "$(python3 - "$_e2e_config" <<'PYEOF'
import json, shlex, sys
for key, value in json.load(open(sys.argv[1])).items():
    if key.startswith("CUBE_") and value != "":
        print(f"export {key}={shlex.quote(str(value))}")
PYEOF
)"
fi
unset _e2e_config
