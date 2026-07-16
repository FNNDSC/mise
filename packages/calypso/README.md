# @fnndsc/calypso

**CALYPSO** **A**ccepts **L**anguage, **Y**ielding **P**ermitted **S**hell **O**perations — the session host and future intent-assistance layer of the [mise](../../README.md) stack.

The name is a harbor reference. In the *Odyssey*, Calypso keeps the island where the voyager finds haven; the name is the Greek word for "to conceal," which the project keeps but turns around. **HARBOR** is that haven for the ChRIS operator, and CALYPSO is the keeper at its edge — the layer between you and the open water: the Collection+JSON sprawl, the complexity of a federated backend. What CALYPSO conceals is the friction, never the outcome. A harbor shelters without holding: the work is left as materialized, verifiable state, yours to leave and return to — CALYPSO the harbor you pass through, never the ground you stand on.

## What this package is

CALYPSO hosts the [brasa](../brasa/README.md) engine behind a **session daemon** and serves it to surfaces over a WebSocket: the [ChELL](../chell/README.md) CLI today, a web console next, each rendering the same session. Because the engine is separable from its display (see [stage one](../../docs/calypso.adoc)), it can run where the data must stay — inside a spoke's trust boundary — while an operator drives it over a thin client.

The wire contract, daemon, session bus, identity-keyed discovery, and ChELL remote client are shipped. The natural-language intent-assistance layer remains separate forward work.

## The wire contract

The contract is defined as [zod](https://zod.dev) schemas — the single source of truth, from which the message types are inferred and against which every message is validated at the boundary.

- **Messages** (two direction-keyed unions): surfaces attach, execute, complete,
  answer prompts, return local pipe results or failures, and return edits; the
  daemon acknowledges attachment, returns results and completion, streams output
  and structured progress, broadcasts session envelopes, pushes prompt context,
  delegates prompts/pipes/edits to the originating surface, and reports errors.
- **Envelope** — the `commandEnvelopeSchema` validates cumin's `CommandEnvelope` on the wire; a compile-time guard keeps the schema in step with cumin's type so the published contract can never silently drift from what the code produces.
- **Boundary validation** — structural violations are rejected; unknown *additive* fields are tolerated, so a daemon accepts extensions from a newer minor without understanding them. Parsing never throws.
- **Versioning** — the contract version (`CONTRACT_VERSION`) is carried in the attach handshake and refused on mismatch; within a major, changes are additive only.

```ts
import { clientMessage_fromJson, attach_parse, type ClientMessage } from '@fnndsc/calypso';

const parsed = clientMessage_fromJson(rawSocketText);
if (!parsed.ok) socket.send({ type: 'error', reason: parsed.error });
```

## Status

The session host is shipped. Version 0.4 adds identity-keyed local berths, so one
OS account can run isolated daemons for several CUBE identities; ChELL resolves
them explicitly or with a picker. Daemon mode warms and reports the shared
startup caches before publishing its listening berth. The full architecture and
the eventual natural-language layer—which may only *propose* commands for the
deterministic shell to validate and run—are documented in
[docs/calypso.adoc](../../docs/calypso.adoc),
[docs/session-supervisor.adoc](../../docs/session-supervisor.adoc), and
[docs/surfaces.adoc](../../docs/surfaces.adoc).
