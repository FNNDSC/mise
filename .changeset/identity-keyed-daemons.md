---
"@fnndsc/calypso": minor
"@fnndsc/chell": minor
---

Run several CALYPSO daemons on one machine — one per CUBE identity — driven by the
same `--daemon` / `--remote` verbs:

```
chell --daemon me@https://cube/api/v1/ -p pw       # my daemon
chell --daemon them@https://cube/api/v1/ -p pw     # their daemon (isolated)
chell --remote me@https://cube/api/v1/             # attach to MY daemon
chell --remote                                     # sole berth attaches; picker if several
```

Daemon discovery is now keyed by identity: each daemon advertises a **berth**
(`{ identity, url, token }`) under `$XDG_RUNTIME_DIR/calypso/` (falling back to the
system temp dir), `0700` on the directory and `0600` on each file. `--daemon` refuses
to start a second daemon for an identity that is already live, pointing at the
running one instead. Bare `--remote` attaches the sole live berth, offers an
interactive picker when several are running, and requires an explicit
`<user>@<url>` in a non-interactive context.

All berth lookup goes through a `BerthResolver` seam (`resolve`, `list`), with a
`LocalBerthResolver` over the runtime files and an injected liveness probe that
reaps berths whose daemon has gone. The seam leaves room for a future network
resolver without any surface change.
