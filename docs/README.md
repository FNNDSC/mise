# mise design docs

Forward-looking design and reasoning for the mise stack — where the project is
going and why. This is not user documentation; for using the shell and the
packages, see the per-package READMEs (start with
[packages/chell](../packages/chell/README.md)).

- **[history.adoc](history.adoc)** — the narrative history of the stack: how mise
  grew from a single adapter that tamed Collection+JSON into a layered command
  substrate, then a shell, then a hostable engine a daemon can serve to many
  surfaces — and why each layer exists. Start here for the story; the documents
  below are the forward design.

- **[intent-kernel.adoc](intent-kernel.adoc)** — a reference for client authors:
  what mise offers a client that is not the shell — a single contract of *intent
  in, receipt out*, reachable in-process (brasa as a library) or over the wire
  (a calypso session), so no client ever speaks Collection+JSON. Marks what exists
  today versus what is forward work.

- **[envelope-model.adoc](envelope-model.adoc)** — the contract that makes the
  above real: every command returns a `CommandEnvelope`, and the move from
  envelopes that carry *text* to envelopes that carry a typed *model* — with the
  rendered string demoted to one view. Includes worked examples (`ls`,
  `feed list`) and the per-command migration recipe.

- **[calypso.adoc](calypso.adoc)** — **CALYPSO**: an intent-interpretation layer
  and session daemon that separates the chell engine from its display and serves
  it over a WebSocket, so remote and web surfaces can drive the same deterministic
  ChRIS command layer — with an eventual natural-language layer that only ever
  *proposes* commands the deterministic shell validates and runs. Includes the
  doctrine, the wire contract, and the staged engineering plan.

- **[surfaces.adoc](surfaces.adoc)** — a companion essay: once server-state
  synchronization is deleted from the client, UI framework choice is demoted from
  architecture to taste, and every surface — framework-based or bespoke — attaches
  to the daemon as a sibling.

- **[structured-progress.md](structured-progress.md)** — the implementation
  contract for CALYPSO structured progress: progress events are facts emitted
  through the sink and daemon wire; terminal bars are renderings of those facts.

- **[handoff.md](handoff.md)** — the concise active project state: current
  milestone, release state, known risks, and next action. Architectural,
  release, and project-state PRs keep it current; completed campaign detail is
  retained under `history/`.

The name **CALYPSO** (_CALYPSO Accepts Language, Yielding Permitted Shell
Operations_) is a harbor reference: in the _Odyssey_, Calypso keeps the island where
the voyager finds haven, and the name is the Greek word for "to conceal." HARBOR is
that haven for the ChRIS operator; CALYPSO keeps its edge, concealing the friction
and never the outcome. See calypso.adoc for the full grounding.
