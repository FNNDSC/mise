# ChELL Stack Makefile
#
# One kitchen for the whole sandwich: cumin, salsa, chili, brasa, calypso, chell.
#
# In the old poly-repo days each package had its own Makefile that ran around
# cloning siblings and hand-linking them. In the monorepo all six live in
# packages/ and npm workspaces wires them together — so the metaphor stays, but
# the plumbing is now a single `npm install` at the root.
#
# The Menu (main commands):
#   make shop    - Freshen the pantry (git pull)
#   make prep    - Install dependencies (one install links all workspaces)
#   make cook    - Build all packages in dependency order (cumin->salsa->chili->brasa->calypso->chell)
#   make taste   - Run the full test suite (all workspaces)
#   make serve   - Link `chell` globally so you can run it from anywhere
#   make scrub   - Clean the kitchen (remove dist/ and node_modules)
#
# The Special:
#   make taco    - The full course: scrub -> prep -> cook -> taste -> serve
#                  (`make meal` is a synonym)
#
# Extras:
#   make taste-flight - Run tests with coverage (Istanbul provider)
#   make run          - Build chell and launch the shell (local, in-process)
#   make login        - Build and connect to a CUBE (prompts for password)
#   make daemon       - Build and run the CALYPSO session daemon
#   make remote       - Build and attach to a running daemon as a surface
#
# Front of house (git + GitHub operations; need an authenticated `gh`):
#   make save MSG=".." - Commit tracked changes with the given message
#   make push          - Push the current branch to origin (sets upstream)
#   make pr            - Push, then open a PR against main
#   make ci-watch      - Wait for the current PR's required checks to settle
#   make merge         - Merge the current branch's PR once checks are green
#   make publish       - Approve, green-wait, and merge the Version Packages PR
#   make verify-npm    - Compare local package versions against the registry
#   make lockfile      - Regenerate package-lock.json with CI's pinned npm
#   make ci-dispatch   - Manually fire the CI workflow (Actions event lag)
#   make release-dispatch - Manually fire the Release workflow on main
#   make sync          - Return to main and fast-forward it
#   make tidy BR=name  - Delete a merged branch locally and on origin
#
# Standard aliases (muscle memory):
#   make install -> prep   make build -> cook   make test -> taste
#   make clean   -> scrub  make link  -> serve  make connect -> login

# Connection defaults for `make login`, overridable on the command line:
#   make login CUBE_URL=http://my-cube:8000/api/v1/ CUBE_USER=me
CUBE_URL  ?= http://localhost:8000/api/v1/
CUBE_USER ?= chris

# The npm version CI installs in every job (ci.yml, release.yml). Lockfiles
# written by a different npm major can omit optional peer entries, and
# `npm ci` then fails with EUSAGE. Everything here that touches the lockfile
# uses this pin.
CI_NPM ?= 11.19.0

# The branch under the knife, for the git-facing targets below.
BRANCH = $(shell git branch --show-current)

.DEFAULT_GOAL := help
.PHONY: help shop prep cook taste taste-flight serve scrub run binaries \
        login connect daemon remote taco meal install build test clean link all \
        save push pr ci-watch merge publish vp-approve verify-npm lockfile \
        ci-dispatch release-dispatch sync tidy

help:
	@echo "ChELL Stack Kitchen"
	@echo ""
	@echo "The Menu:"
	@echo "  make shop          - Freshen the pantry (git pull)"
	@echo "  make prep          - Install dependencies (links all workspaces)"
	@echo "  make cook          - Build all packages in dependency order"
	@echo "  make taste         - Run the full test suite"
	@echo "  make serve         - Link 'chell' globally"
	@echo "  make scrub         - Clean dist/ and node_modules everywhere"
	@echo ""
	@echo "The Special:"
	@echo "  make taco          - Full course: scrub, prep, cook, taste, serve"
	@echo ""
	@echo "Extras:"
	@echo "  make taste-flight  - Tests with coverage (Istanbul provider)"
	@echo "  make run           - Build chell and launch the shell (local)"
	@echo "  make login         - Build and connect to a CUBE (prompts for password)"
	@echo "                       override: make login CUBE_URL=... CUBE_USER=..."
	@echo "  make daemon        - Build and run the CALYPSO session daemon"
	@echo "  make remote        - Build and attach to a running daemon"
	@echo "  make binaries      - Build standalone chell executables (no Node needed)"
	@echo ""
	@echo "Front of house (git + GitHub; needs an authenticated 'gh'):"
	@echo "  make save MSG=\"..\" - Commit tracked changes with MSG as the message"
	@echo "                       (new files need an explicit 'git add' first)"
	@echo "  make push          - Push the current branch to origin, setting upstream"
	@echo "  make pr            - Push, then open a PR against main (body from commits)"
	@echo "  make ci-watch      - Wait for this branch's PR checks (audit, node 22/24)"
	@echo "  make merge         - ci-watch, then merge this branch's PR (merge commit)"
	@echo "  make publish       - The release step: approve the Version Packages PR's"
	@echo "                       bot CI runs, wait for green, merge. Merging it makes"
	@echo "                       the Release workflow publish to npm (IRREVERSIBLE)."
	@echo "  make verify-npm    - Local package.json versions vs the npm registry"
	@echo "  make lockfile      - Regenerate package-lock.json with npm@$(CI_NPM)"
	@echo "                       (CI's pin) and prove it with a dry-run 'npm ci'"
	@echo "  make ci-dispatch   - Fire CI by hand on this branch (when GitHub's"
	@echo "                       push/PR events lag and no run appears)"
	@echo "  make release-dispatch - Fire Release by hand on main (same lag, or to"
	@echo "                       retry a publish; publishing is idempotent)"
	@echo "  make sync          - Checkout main, fast-forward, prune stale remotes"
	@echo "  make tidy BR=name  - Delete a merged branch locally and on origin"
	@echo ""
	@echo "Aliases: install=prep  build=cook  test=taste  clean=scrub  link=serve  connect=login"

# --- Shop (freshen the pantry) ---
# Nothing to clone anymore — every ingredient is vendored in packages/.
# A shop run just pulls the latest monorepo.
shop:
	@echo "Freshening the pantry (git pull)..."
	@git pull --rebase --autostash || echo "Could not pull. Resolve manually (offline is fine)."

# --- Prep (install dependencies) ---
# One install hydrates every workspace AND links them to each other.
# Uses CI's pinned npm ($(CI_NPM), matching "packageManager" in package.json):
# an install with a different npm major rewrites the lockfile in a shape
# `npm ci` under the CI pin then refuses (EUSAGE, missing optional peers).
prep:
	@echo "Prepping all packages (npm install, npm@$(CI_NPM))..."
	npx --yes npm@$(CI_NPM) install

# --- Cook (build) ---
# Root build script already enforces topological order: cumin->salsa->chili->brasa->calypso->chell.
cook:
	@echo "Cooking the whole stack (dependency order)..."
	npm run build

# --- Taste (test) ---
taste:
	@echo "Tasting (running all tests)..."
	npm test

# Coverage flight (not part of taco)
taste-flight:
	@echo "Tasting flight (coverage, istanbul provider)..."
	npm test --workspaces --if-present -- --coverage

# --- Serve (link chell globally) ---
serve:
	@echo "Serving — linking 'chell' globally..."
	cd packages/chell && npm link
	@echo "Done. Run 'chell' from anywhere."

# --- Scrub (clean) ---
scrub:
	@echo "Scrubbing the kitchen..."
	rm -rf node_modules
	rm -rf packages/*/node_modules packages/*/dist packages/*/types
	@echo "Kitchen is clean."

# --- Run (build + launch local shell) ---
run: cook
	@echo "Launching chell..."
	node packages/chell/dist/index.js

# --- Login (build + connect to a CUBE) ---
# Connect mode: prompts for the password, then drops into the shell already
# connected (the refreshed token is saved). Override the target CUBE with
# CUBE_URL / CUBE_USER, e.g. `make login CUBE_URL=http://my-cube/api/v1/ CUBE_USER=me`.
login connect: cook
	@echo "Connecting to $(CUBE_USER)@$(CUBE_URL) (you'll be prompted for a password)..."
	node packages/chell/dist/index.js --user $(CUBE_USER) $(CUBE_URL)

# --- Daemon (build + host the engine over WebSocket) ---
# Starts the CALYPSO session daemon on loopback and writes its discovery file
# (URL + attach token). Attach from another terminal with `make remote`.
daemon: cook
	@echo "Starting the CALYPSO session daemon (attach with 'make remote')..."
	node packages/calypso/dist/calypso.js

# --- Remote (build + attach to a running daemon) ---
# Reads the daemon's discovery file and attaches as a remote surface. Run
# `make daemon` in one terminal first, then `make remote` in another.
remote: cook
	@echo "Attaching to the CALYPSO daemon as a remote surface..."
	node packages/chell/dist/index.js --remote

# --- Binaries (standalone executables, no Node required on the target) ---
binaries: cook
	@echo "Building standalone chell executables (esbuild bundle -> pkg)..."
	npm run binaries -w @fnndsc/chell
	@echo "Binaries in packages/chell/build/bin/"

# ---------------------------------------------------------------------------
# Front of house: the git and GitHub chores of getting work merged and
# published, encoded so the flow does not depend on anyone (or any LLM)
# remembering it. Everything below the commit itself needs an authenticated
# `gh`. The flow, end to end:
#
#   make save MSG=".." -> make pr -> make merge -> make publish -> make verify-npm
# ---------------------------------------------------------------------------

# Commit tracked changes only (`git add -u`): untracked scratch files never
# ride along by accident. Stage new files explicitly before saving.
save:
ifndef MSG
	$(error MSG is required: make save MSG="what changed and why")
endif
	git add -u
	git commit -m "$(MSG)"

push:
	git push -u origin $(BRANCH)

# Opens the PR against main with title and body drawn from the branch's
# commits (--fill). Edit on GitHub afterwards if the autogenerated body
# undersells it.
pr: push
	gh pr create --base main --fill

# Waits for the required contexts (audit, check 22, check 24) on this
# branch's PR. The first loop covers the gap before GitHub registers any
# checks at all; --watch then follows them to a verdict.
ci-watch:
	@gh pr view --json number >/dev/null || { echo "No PR for $(BRANCH); run 'make pr' first."; exit 1; }
	@echo "Waiting for required checks on the $(BRANCH) PR..."
	@until gh pr checks --required 2>/dev/null | grep -q .; do sleep 15; done
	@gh pr checks --watch --interval 30 --required

merge: ci-watch
	gh pr merge --merge
	@echo "Merged. 'make sync' fast-forwards local main; 'make publish' releases"
	@echo "any pending changesets via the Version Packages PR."

# Bot-opened PRs (the changesets Version Packages PR) get their CI runs
# parked as action_required; this approves them so the checks can run.
vp-approve:
	@for id in $$(gh api "repos/{owner}/{repo}/actions/runs?branch=changeset-release/main&status=action_required" --jq '.workflow_runs[].id'); do \
		echo "Approving CI run $$id..."; \
		gh api -X POST "repos/{owner}/{repo}/actions/runs/$$id/approve" >/dev/null; \
	done

# The release step. Merging the Version Packages PR triggers the Release
# workflow on main, which publishes every bumped package to npm — an
# irreversible, outward-facing act, which is why it is its own target and
# never chained onto `merge`.
publish: vp-approve
	@pr=$$(gh pr list --head changeset-release/main --state open --json number --jq '.[0].number'); \
	if [ -z "$$pr" ]; then echo "No open Version Packages PR (nothing to publish)."; exit 1; fi; \
	echo "Version Packages PR #$$pr — waiting for required checks..."; \
	until gh pr checks $$pr --required 2>/dev/null | grep -q .; do sleep 15; done; \
	gh pr checks $$pr --watch --interval 30 --required && \
	gh pr merge $$pr --merge
	@echo "Publish merge done; the Release workflow on main now pushes to npm."
	@echo "If no Release run appears (Actions event lag): make release-dispatch"
	@echo "Then confirm with: make verify-npm"

# Local package.json versions against what the registry serves, one line
# per package. After a publish the two columns must agree.
verify-npm:
	@for p in cumin salsa chili brasa calypso chell; do \
		printf "%-8s local %-8s npm %s\n" $$p \
			"$$(node -p "require('./packages/$$p/package.json').version")" \
			"$$(npm view @fnndsc/$$p version 2>/dev/null || echo '?')"; \
	done

# Regenerates the lockfile with CI's npm pin and proves the result with a
# dry-run `npm ci` — the exact command CI runs first.
lockfile:
	@echo "Regenerating package-lock.json with npm@$(CI_NPM) (CI's pin)..."
	npx --yes npm@$(CI_NPM) install --package-lock-only
	@echo "Verifying with a dry-run npm ci..."
	@npx --yes npm@$(CI_NPM) ci --dry-run >/dev/null && echo "Lockfile in sync."

# GitHub's push/pull_request event delivery occasionally lags for minutes
# and no workflow run appears; these fire the workflows by hand.
ci-dispatch:
	gh workflow run ci.yml --ref $(BRANCH)
	@echo "CI dispatched on $(BRANCH); follow with 'make ci-watch'."

release-dispatch:
	gh workflow run release.yml --ref main

sync:
	git checkout main
	git pull --ff-only
	git fetch --prune

tidy:
ifndef BR
	$(error BR is required: make tidy BR=branch-name)
endif
	git branch -d $(BR)
	git push origin --delete $(BR) || echo "(remote branch already gone)"

# --- The Big One ---
taco: scrub prep cook taste serve
meal: taco

# --- Standard Aliases ---
install: prep
build: cook
test: taste
clean: scrub
link: serve
all: taco
