---
"@fnndsc/calypso": minor
---

The daemon now rides an explicit HTTP server: WebSocket upgrades carry the session contract unchanged, and plain GETs serve a configured static web root (the built ARGUS surface), discovered from `CALYPSO_WEB_ROOT` or a monorepo checkout's `apps/argus/dist`. The launcher prints the browser URL with the attach token. A new `@fnndsc/calypso/protocol` subpath exports the browser-safe wire contract (schemas, validation, version) without server-side dependencies.
