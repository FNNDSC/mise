---
"@fnndsc/chell": minor
---

`calypso` is now its own command. It is `chell --daemon` under a dedicated name — hosting one engine over a loopback WebSocket for remote surfaces to attach to — and shares chell's entire connection surface: the `user@url` shorthand, `--user`, and the hidden password prompt all work exactly as they do for `chell` (bare `calypso` inherits the saved session; `calypso rudolphpienaar@http://cube/api/v1/` prompts and connects at startup). Attach a surface with `chell --remote`. The DEP0169 warning suppression shared by both entry points moved into `core/warnings.ts`, and `chell_start` now accepts an argv override so the `calypso` entry can force daemon mode without duplicating the bootstrap.
