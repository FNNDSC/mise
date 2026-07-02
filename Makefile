# ChELL Stack Makefile
#
# One kitchen for the whole sandwich: cumin, salsa, chili, chell.
#
# In the old poly-repo days each package had its own Makefile that ran around
# cloning siblings and hand-linking them. In the monorepo all four live in
# packages/ and npm workspaces wires them together — so the metaphor stays, but
# the plumbing is now a single `npm install` at the root.
#
# The Menu (main commands):
#   make shop    - Freshen the pantry (git pull)
#   make prep    - Install dependencies (one install links all four workspaces)
#   make cook    - Build all packages in dependency order (cumin->salsa->chili->chell)
#   make taste   - Run the full test suite (all workspaces)
#   make serve   - Link `chell` globally so you can run it from anywhere
#   make scrub   - Clean the kitchen (remove dist/ and node_modules)
#
# The Special:
#   make taco    - The full course: scrub -> prep -> cook -> taste -> serve
#                  (`make meal` is a synonym)
#
# Extras:
#   make taste-flight - Run tests with coverage (v8 provider)
#   make run          - Build chell and launch the shell
#
# Standard aliases (muscle memory):
#   make install -> prep   make build -> cook   make test -> taste
#   make clean   -> scrub  make link  -> serve

.DEFAULT_GOAL := help
.PHONY: help shop prep cook taste taste-flight serve scrub run binaries \
        taco meal install build test clean link all

help:
	@echo "ChELL Stack Kitchen"
	@echo ""
	@echo "The Menu:"
	@echo "  make shop          - Freshen the pantry (git pull)"
	@echo "  make prep          - Install dependencies (links all four workspaces)"
	@echo "  make cook          - Build all packages in dependency order"
	@echo "  make taste         - Run the full test suite"
	@echo "  make serve         - Link 'chell' globally"
	@echo "  make scrub         - Clean dist/ and node_modules everywhere"
	@echo ""
	@echo "The Special:"
	@echo "  make taco          - Full course: scrub, prep, cook, taste, serve"
	@echo ""
	@echo "Extras:"
	@echo "  make taste-flight  - Tests with coverage (v8 provider)"
	@echo "  make run           - Build chell and launch the shell"
	@echo "  make binaries      - Build standalone chell executables (no Node needed)"
	@echo ""
	@echo "Aliases: install=prep  build=cook  test=taste  clean=scrub  link=serve"

# --- Shop (freshen the pantry) ---
# Nothing to clone anymore — every ingredient is vendored in packages/.
# A shop run just pulls the latest monorepo.
shop:
	@echo "Freshening the pantry (git pull)..."
	@git pull --rebase --autostash || echo "Could not pull. Resolve manually (offline is fine)."

# --- Prep (install dependencies) ---
# One install hydrates every workspace AND links them to each other.
prep:
	@echo "Prepping all packages (npm install)..."
	npm install

# --- Cook (build) ---
# Root build script already enforces topological order: cumin->salsa->chili->chell.
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

# --- Run (build + launch) ---
run: cook
	@echo "Launching chell..."
	node packages/chell/dist/index.js

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
