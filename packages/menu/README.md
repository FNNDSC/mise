# @fnndsc/menu

The mise wire contract: what a command returns, what a session exchanges, and
the vocabularies both narrow to.

A menu declares what may be ordered and what arrives. A surface can ask for
anything on it and nothing off it, which is the architectural claim this
package exists to make structural: no capability exists outside the kernel and
the wire, while every surface is free to compose and present as it likes above
that line.

## What's in it

| Module | Contents |
| --- | --- |
| `envelope.ts` | `CommandEnvelope` and its parts — status, typed model slot, error stack, resolution trace |
| `messages.ts` | The session protocol: attach, execute, complete, output, progress, prompt, pipe, shell, edit |
| `validate.ts` | Boundary parsing that never throws — a `ParseResult`, so a caller can answer rather than crash |
| `version.ts` | `CONTRACT_VERSION` and its exact-major compatibility rule |
| `progress.ts` | The structured-progress vocabulary |
| `proc.ts` | Prompt-facing process-index state |

## Why it is its own package

A surface author depends on the contract, not on the daemon that happens to
serve it. Before this package the contract was a subpath of `@fnndsc/calypso`,
which meant a third-party surface took a dependency on the session host to
learn the shape of a result.

It imports nothing from the stack — `zod` and nothing else — and sits below
`cumin`, so both the engine that produces envelopes and the browser that renders
them can load it.

## Rules that hold here

**Open world.** An envelope's `model.kind` is a free string: a surface narrows
what it recognises and falls back to `rendered` for the rest. Unknown enum
values degrade rather than reject — an unknown progress operation reads as
`task`, an unknown phase as `working` — because a dropped message is invisible
and a generic indicator is not.

**Never `.strict()`.** A plain `z.object()` strips unknown keys, so a field
added by a newer peer is ignored rather than fatal. `.strict()` looks like
rigour and is a compatibility break.

**A new enum value ships with a fallback.** `safeParse` fails a whole message on
one unknown value. When you add to an enum on the wire, give it a `.catch()` in
the same change if it has none.

**Types are inferred, never declared twice.** Payload types come from
`z.infer<typeof schema>`. The envelope and the wire once carried separate
declarations held together by a compile-time assertion; one inferred type makes
that drift impossible rather than detected.

## See also

- `docs/menu.adoc` — the design record and the plan this package is part of
- `docs/principles.adoc` — the normative architecture
- `docs/structured-progress.md` — the progress contract in detail
