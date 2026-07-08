---
"@fnndsc/calypso": minor
"@fnndsc/chell": minor
---

Push the themed prompt string to remote surfaces. Only the daemon holds the session context the prompt renders, so it renders the prompt and pushes it (a new `promptline` message) to every surface on attach and after each command — the context may have changed. A surface prints what it receives, so prompt themes look identical whether the session is local or remote. chell factors prompt rendering into a shared `sessionPrompt_render` used by both the local REPL and the daemon's `promptProvider`; the `chell --remote` client renders the latest pushed prompt (falling back to a fixed string until the first push), replacing the placeholder prompt it showed before.
