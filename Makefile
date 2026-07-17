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
# Standard aliases (muscle memory):
#   make install -> prep   make build -> cook   make test -> taste
#   make clean   -> scrub  make link  -> serve  make connect -> login

# Connection defaults for `make login`, overridable on the command line:
#   make login CUBE_URL=http://my-cube:8000/api/v1/ CUBE_USER=me
CUBE_URL  ?= http://localhost:8000/api/v1/
CUBE_USER ?= chris

.DEFAULT_GOAL := help
.PHONY: help shop prep cook taste taste-flight serve scrub run binaries \
        login connect daemon remote taco meal install build test clean link all

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
	@echo "Aliases: install=prep  build=cook  test=taste  clean=scrub  link=serve  connect=login"

# --- Shop (freshen the pantry) ---
# Nothing to clone anymore — every ingredient is vendored in packages/.
# A shop run just pulls the latest monorepo.
shop:
	@echo "Freshening the pantry (git pull)..."
	@git pull --rebase --autostash || echo "Could not pull. Resolve manually (offline is fine)."

# --- Prep (install dependencies) ---
# One install hydrates every workspace AND links them to each other.
# Uses the repo-pinned npm (see "packageManager" in package.json): newer npm
# majors regenerate the lockfile differently (breaking npm ci in CI) and
# npm 11 prints spurious ERESOLVE peer warnings when overrides are present.
prep:
	@echo "Prepping all packages (npm install, pinned npm)..."
	npx --yes npm@10.9.8 install

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
