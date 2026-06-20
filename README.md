# @fnndsc/tui

Monorepo for the **ChELL** stack — an interactive ChRIS terminal shell built as
four layered, independently-published npm packages:

```
packages/
  chell    @fnndsc/chell    REPL / CLI            ← top
  chili    @fnndsc/chili    controller / commands
  salsa    @fnndsc/salsa    logic / intents
  cumin    @fnndsc/cumin    state / infra
                            └ @fnndsc/chrisapi    REST client (external, from npm)
```

## Use it

```bash
npm install -g @fnndsc/chell
chell
```

Lower layers are reusable on their own (e.g. from a web client):

```bash
npm install @fnndsc/cumin @fnndsc/salsa
```

## Develop

```bash
git clone https://github.com/FNNDSC/tui
cd tui
npm install        # one install links all four workspaces

npm run build      # build all (dependency order)
npm test           # test all
node packages/chell/dist/index.js
```

Edit any layer, rebuild it (`npm run build -w @fnndsc/cumin`), run chell — the
upper layers pick up the change via the workspace symlink.

## Release

Changesets, independent versioning, automated:

```bash
npx changeset      # record what changed (per PR)
```
On merge to `main`, CI opens a "Version Packages" PR; merging it publishes the
changed packages to npm in topological order.

## Requirements

Node ≥ 20.12 (22.x recommended).

## History

The four packages were previously separate repos (`FNNDSC/{cumin,salsa,chili,chell}`);
their full git history is preserved here under `packages/<name>/`, with tags
namespaced as `<name>-vX.Y.Z`.
