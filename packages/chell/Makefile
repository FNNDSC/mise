# Chell Makefile
#
# Build and manage the Chell Interactive Shell

CUMIN_DIR := ../cumin
SALSA_DIR := ../salsa
CHILI_DIR := ../chili
CHELL_DIR := .

.PHONY: help prep cook taste serve scrub meal install build test clean link all

help:
	@echo "Chell Makefile 🐚"
	@echo ""
	@echo "Commands:"
	@echo "  make prep    - Install dependencies"
	@echo "  make cook    - Build dependencies (cumin, salsa, chili) and chell"
	@echo "  make taste   - Run tests"
	@echo "  make serve   - Link globally"
	@echo "  make scrub   - Clean artifacts"
	@echo "  make meal    - Full build (scrub, prep, cook)"

prep:
	@echo "🔪 Prepping chell (installing deps)..."
	cd $(CHELL_DIR) && npm install

cook:
	@echo "🍳 Cooking dependencies..."
	cd $(CUMIN_DIR) && npm install && npm run build
	cd $(SALSA_DIR) && npm install && npm run build
	cd $(CHILI_DIR) && npm install && npm run build
	@echo "🍳 Cooking chell..."
	cd $(CHELL_DIR) && npm run build

taste:
	@echo "👅 Tasting chell..."
	cd $(CHELL_DIR) && npm test

serve:
	@echo "🍽️ Serving chell..."
	cd $(CHELL_DIR) && npm link

scrub:
	@echo "🧽 Scrubbing chell..."
	cd $(CHELL_DIR) && rm -rf dist node_modules package-lock.json

meal: scrub prep cook

install: prep
build: cook
test: taste
clean: scrub
link: serve
all: meal