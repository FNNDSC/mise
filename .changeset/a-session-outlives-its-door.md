---
"@fnndsc/porter": minor
"@fnndsc/calypso": patch
"@fnndsc/chell": patch
---

A session outlives its door: the porter's lifecycle.

porter: a restarted porter adopts the sessions its predecessor started, from their berths under the state directory, rather than starting rivals. Idle sessions — no wire open, nothing through the door for `PORTER_IDLE_HOURS` (a day, like the cookie) — are ended by a sweep every minute: the process only; the state directory stays and the next login boots warm. `porter --status` lists the state directory's sessions and whether each answers. `deploy/` carries a systemd unit (a `porter` user, `KillMode=process` so a stopped door keeps its sessions), an env file example, and a Caddyfile for TLS in front. Boot lines kept per session are capped at 2000.

calypso: a berth records the daemon's pid, so a host that did not start a daemon can still end it.

chell: a daemon off a TTY tolerates EPIPE on its stdout and stderr — the porter that started it may stop first, and a session outlives its door.
