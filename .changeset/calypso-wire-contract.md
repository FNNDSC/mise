---
"@fnndsc/calypso": minor
---

Introduce `@fnndsc/calypso`, the fifth mise package: the session daemon that will host the chell engine and serve it to surfaces over a WebSocket. This first slice is the wire contract — the typed protocol schemas and boundary validation every message crosses. Messages are two direction-keyed discriminated unions (surface→daemon: attach/execute/complete; daemon→surface: attached/result/complete/output/session/error), defined as zod schemas that are the single source of truth and from which the message types are inferred. A `commandEnvelopeSchema` validates cumin's `CommandEnvelope` on the wire, kept in step with cumin's type by a compile-time guard so the contract cannot silently drift. Boundary validation rejects structural violations, tolerates unknown additive fields, and never throws; the contract version is carried in the attach handshake and refused on mismatch. See docs/calypso.adoc for the governing design.
