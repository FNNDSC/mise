---
'@fnndsc/brasa': minor
'@fnndsc/calypso': minor
'@fnndsc/chell': minor
---

`download` no longer writes to the daemon host's disk. File delivery is now a
surface capability, like prompting, piping and editing already were.

The builtin resolved its destination with `path.resolve()` inside the engine,
so the bytes landed on whatever machine hosted the engine. For a local shell
that is right — the engine is in-process and the operator's disk is the
engine's disk. Under a daemon it put files on a machine nobody attending the
session was sitting at, and from a browser the question "download to where?"
had no answer at all.

`Surface` gains `fileDeliver`, and `SurfaceCapabilities` gains `fileDelivery`
alongside `engineFilesystem` — which says whether a path the engine resolves is
a path this surface's operator can open. Only an in-process local shell claims
it. When it is false, `download` hands the file to the surface, which puts it
somewhere its operator can actually reach: the client's disk for
`chell --remote`, the download manager for `argus`.

Only the request crosses the wire. Each surface fetches the bytes itself
through the daemon's existing token-gated `/vfs` route, so a DICOM series is
not base64'd across a channel meant for session state — the intent travels
through the vocabulary and the bytes travel through the byte route.

The local path is unchanged: a local `chell` still uses the existing transfer
machinery, with its globs, directory walks and progress reporting.

A directory has no bytes to hand over, and a browser cannot receive several
hundred DICOM instances as several hundred saves. So a directory requested by a
surface with no filesystem is archived into a single CUBE file first, through
the registered `zip v20240311` pipeline — `pl-dircopy` into a zip plugin, the
same mechanism the ChRIS web UI has used for years, but living in `brasa` where
every surface reaches one implementation instead of each client re-deriving the
sequence. `CHRIS_ARCHIVE_PIPELINE` names a different pipeline where a
deployment registered one. When it is absent, the failure says which pipeline
is missing and that it can be registered from the store.

The archive run announces itself rather than creating a feed silently, because
it is a workaround for CUBE having no directory-archive route: issue #233.

`upload` has the mirror problem — it reads from the engine host's disk — and is
not addressed here, because the browser direction needs a file picker. See
issue #232.
