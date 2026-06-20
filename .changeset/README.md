# Changesets

This folder is managed by [changesets](https://github.com/changesets/changesets).

To record a change for release, run:

```
npx changeset
```

Pick the affected package(s) and bump type (patch/minor/major), write a summary.
On merge to `main`, CI opens a "Version Packages" PR; merging it publishes the
changed packages to npm in dependency order (cumin → salsa → chili → chell).
