---
'@fnndsc/brasa': minor
'@fnndsc/chell': minor
'@fnndsc/calypso': minor
---

Greet every surface with the stack's identity. Builds now record the short git hash they were produced from (`dist/buildinfo.json`, written by the new `scripts/buildinfo.mjs` build step), and brasa exposes it through `buildHash_get` alongside `welcomeLine_build`/`welcomeLine_compose`, which render a banner of the form `ChELL Executes Layered Logic, v 5.3.0 (886f09). Welcome.` An interactive chell session prints the banner and a short fortune at boot, the calypso daemon announces its banner plus an aligned version line for every stack layer (chell, brasa, chili, salsa, cumin, calypso) when it starts listening, and the attach handshake gains an optional `stack` field carrying all six versions and the build hash, so a remote surface banners the daemon's full reported stack rather than its local install's. `fortune_random` is exported for reuse, with an optional line-count bound so banners favour short cookies.
