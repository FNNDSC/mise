---
"@fnndsc/cumin": minor
"@fnndsc/brasa": minor
"@fnndsc/chell": minor
"@fnndsc/menu": minor
---

The door hands a token: a session can be started by a front that already logged the operator in.

Today a session is started by the operator, at a terminal, with a password: `chell user@url -p … --daemon`. A login front on a shared host — the porter, the display manager the browser surface needs — exchanges the password for a CUBE token itself and holds the token, never the password. This is the seam that lets it start a session with what it holds.

- cumin `connection_connectWithToken({ user, url, token })`: proves the token against the server BEFORE writing anything, so a refusal leaves the saved context alone; never exits the process; the refusal travels in the outcome, not on the error stack.
- brasa `sessionConnect_withToken(user, url, token)`: the headless connect beside `sessionConnect_fromSaved`, setting the context the way a credentialed boot does and leaving the working directory as it was.
- chell `--auth-token-stdin`: the token comes in on stdin, one line, never on argv where `ps` shows it to the host. Refuses by name: without a `<user>@<url>`, beside `--password`, or with no line on the stream. The boot row reads `Connect  Connected to <url> (token)`.
- chell `--daemon` off a TTY no longer spawns a console onto its pipe — a boot ends at a login only where there is a terminal to log in on; otherwise the daemon says so and keeps listening, as the standalone `calypso` binary already did.
- menu `@fnndsc/menu/logo`: the mise brain and its frame renderer move from the kernel to the wire package, decoding with `atob` and touching no Node builtin, so a browser can draw the same brain a terminal boot does. brasa re-exports it; chell and calypso keep their import.

Exemplar `14_tokenLogin` starts a daemon this way against a live CUBE, off a TTY, in isolated directories, and proves the Connect row and a live berth.
