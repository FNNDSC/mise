---
"@fnndsc/argus": minor
"@fnndsc/calypso": minor
---

ARGUS is published, and a released install now serves it. `@fnndsc/argus` ships its built bundle, calypso depends on it, and the daemon's web-root search ends by resolving the installed package — so `npm install -g @fnndsc/chell` followed by `chell --daemon` prints a URL a browser can open, where before it printed only a WebSocket address. The unused `@fnndsc/calypso` dependency is dropped from argus, whose browser code imports only the wire contract.
