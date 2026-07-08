# @fnndsc/calypso

**C**ognitive **A**lgorithms & **L**ogic **Y**ielding **P**redictive **S**cientific **O**utcomes — the intent layer and session daemon of the [mise](../../README.md) stack.

The name is a harbor reference. In the *Odyssey*, Calypso keeps the island where the voyager finds haven; the name is the Greek word for "to conceal," which the project keeps but turns around. **HARBOR** is that haven for the ChRIS operator, and CALYPSO is the keeper at its edge — the layer between you and the open water: the Collection+JSON sprawl, the complexity of a federated backend. What CALYPSO conceals is the friction, never the outcome. A harbor shelters without holding: the work is left as materialized, verifiable state, yours to leave and return to — CALYPSO the harbor you pass through, never the ground you stand on.

## What this package is

CALYPSO hosts the [chell](../chell/README.md) engine behind a **session daemon** and serves it to surfaces over a WebSocket: the CLI today, a web console next, each rendering the same session. Because the engine is separable from its display (see [stage one](../../docs/calypso.adoc)), it can run where the data must stay — inside a spoke's trust boundary — while an operator drives it over a thin client.

This first slice is the **wire contract**: the typed protocol schemas and boundary validation every message crosses. The daemon, the session bus, and the remote client build on it.

## The wire contract

The contract is defined as [zod](https://zod.dev) schemas — the single source of truth, from which the message types are inferred and against which every message is validated at the boundary.

- **Messages** (two direction-keyed unions):
  - surface → daemon: `attach {protocolVersion, token, session?}`, `execute {id, line}`, `complete {id, prefix}`
  - daemon → surface: `attached`, `result {id, envelopes}`, `complete {id, prefix, candidates}`, `output {id, channel, chunk}`, `session {surface, envelope}`, `error`
- **Envelope** — the `commandEnvelopeSchema` validates cumin's `CommandEnvelope` on the wire; a compile-time guard keeps the schema in step with cumin's type so the published contract can never silently drift from what the code produces.
- **Boundary validation** — structural violations are rejected; unknown *additive* fields are tolerated, so a daemon accepts extensions from a newer minor without understanding them. Parsing never throws.
- **Versioning** — the contract version (`CONTRACT_VERSION`) is carried in the attach handshake and refused on mismatch; within a major, changes are additive only.

```ts
import { clientMessage_fromJson, attach_parse, type ClientMessage } from '@fnndsc/calypso';

const parsed = clientMessage_fromJson(rawSocketText);
if (!parsed.ok) socket.send({ type: 'error', reason: parsed.error });
```

## Status

Design-in-progress, not shipped. The full design — daemon, session bus, remote client, and the eventual natural-language intent layer that only ever *proposes* commands the deterministic shell validates and runs — is in [docs/calypso.adoc](../../docs/calypso.adoc) (the staged plan) and [docs/surfaces.adoc](../../docs/surfaces.adoc).
