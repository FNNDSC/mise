---
"@fnndsc/brasa": minor
"@fnndsc/calypso": minor
---

The engine can now hand raw file bytes to a hosting daemon: brasa's `BrasaEngine` gains an optional `file_read(filePath)` that resolves a ChRIS VFS path to a `Buffer` through chili's binary cat. Calypso's daemon exposes it as a token-gated `/vfs?path=&token=` HTTP route with extension-derived content types, letting a web surface render images and other binary content that a text transcript cannot carry.
