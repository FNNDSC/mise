---
'@fnndsc/calypso': minor
'@fnndsc/chell': minor
---

Unify the five correlation-id request/reply implementations onto one `RequestBroker`. The daemon's four surface-delegated brokers (prompt, pipeline segment, host shell, edit) and the remote client's own pending-request map previously each reimplemented the id/pending/close lifecycle with divergent correctness; all five now share one class that uniformly guarantees origin-validated settles (no surface can answer another surface's prompt), close-listener removal on settle (no per-request listener leak), and rejection when the origin disconnects. The protocol gains optional `promptError` and `editError` messages (additive, no version bump) so a surface can report a failed or impossible prompt or edit. Behavior change on the remote surface: a client without a prompt, pipe, or edit handler now reports the inability as an error instead of silently answering empty, passing pipe input through unchanged, or returning an unchanged "successful" edit.
