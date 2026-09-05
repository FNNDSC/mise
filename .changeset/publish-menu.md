---
"@fnndsc/menu": patch
"@fnndsc/cumin": patch
"@fnndsc/brasa": patch
"@fnndsc/chell": patch
"@fnndsc/calypso": patch
---

fix(release): publish `@fnndsc/menu`, without which nothing else installs

`@fnndsc/menu` was marked private, so changesets versioned it and then skipped publishing it. cumin, brasa, chell and calypso all depend on it, so every published version since menu was extracted has been uninstallable from a clean registry:

```
npm install @fnndsc/brasa
npm error 404  The requested resource '@fnndsc/menu@*' could not be found
```

It worked in development only because the workspace resolves menu locally, and it went unnoticed because nothing ever installed these packages from npm alone.

menu is an ordinary library — the wire schemas and types three published packages import. Its manifest was already publish-ready and identical in shape to its siblings; only the flag stood in the way. It is dropped.

The dependency range is pinned to `^0.3.0` at the same time. `"*"` was an artefact of menu being private, since changesets does not rewrite ranges for packages it will not publish, and `"*"` on a published dependency means any future breaking change applies silently.

`argus` stays private, and correctly so: it is a browser bundle served from calypso's web root, not a library anyone imports.
