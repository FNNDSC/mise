---
"@fnndsc/chell": minor
---

Extract the engine facade (`engine_create`, `line_execute`, `line_complete`, `ChellEngine`): line-level orchestration — shell escape, semicolon batching, redirects, pipes — now lives in `core/engine.ts` and yields one `CommandEnvelope` per executed command, while output continues to reach the active sink live. The REPL shrinks to a thin host (read line → engine → sink), dispatch gains envelope-producing execution (`command_dispatchEnvelope`, `command_executeToEnvelope`, `redirect_execute`, `pipe_execute`), and the unknown-command chili fallback now runs through the capture bridge so it too produces envelopes. Observable CLI behavior is byte-identical.
