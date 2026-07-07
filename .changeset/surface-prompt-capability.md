---
"@fnndsc/chell": minor
---

Make interactivity a declared surface capability. A new surface seam (`core/surface.ts`) is the input-side counterpart to the output sink: a host installs a `Surface` that declares what interaction it can offer (`hiddenInput`, `localEdit`, `tty`) and backs prompting, and a builtin can require a capability via `capability_require` and fail with a clear message instead of hanging on a standard input that is not there. The CLI host installs a readline-backed surface (`core/cliSurface.ts`) — persistent on the REPL's interface, one-shot in execute/script modes — preserving the single-readline, no-echo-leak discipline. `question.ts`'s `repl_question` / `repl_questionHidden` now delegate to the active surface (salsa's admin-prompt flow and the prompt builtin are unchanged), and the `edit` builtin declares its need for `localEdit`. CLI behavior is byte-identical.
