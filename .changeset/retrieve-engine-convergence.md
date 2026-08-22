---
'@fnndsc/cumin': minor
'@fnndsc/salsa': minor
'@fnndsc/brasa': minor
---

Converge the two PACS retrieve watchers onto one engine. pull's battle-tested LONK machinery (bounded, retried firing; stall/timeout/no-activity detection; storage confirmation; refire loop) moves into salsa as the presentation-free `retrieve/watch` module; the `pull` builtin becomes a thin consumer rendering engine events onto its sink, and the PACS VFS provider's `cp` drops its 5-second polling watcher for the same engine, gaining firing retry, LONK push, and the idempotency skip. The convergence surfaced and fixed two latent defects that had made PACS `cp` unusable on real paths: the source parser assumed paths without the `/queries/` segment and rejected every real listing path, and the file downloader only consulted the userfiles collection, so PACS files under `/SERVICES` read as "not found"; it now falls back to the PACS files collection. Supporting dedup: cumin gains `retry_untilValue` (the one bounded-backoff loop) and `seriesStorage_resolve` gains bounded re-probing, replacing the per-package storage-resolver copies; the `_qid:` parser is now shared from salsa.
