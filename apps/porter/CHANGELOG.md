# @fnndsc/porter

## 0.3.3

### Patch Changes

- 98b839f: A session whose daemon died is no longer proxied to the dead port: a login that boots a new daemon replaces the stale entry, and a mount whose daemon does not answer follows the session to its new berth or sends the browser to the door, instead of a bare 500 ECONNREFUSED.

## 0.3.2

### Patch Changes

- 05b9b41: porter: `porter --status` marks the pid on a gone row as stale. The berth outlives a daemon killed with -9, and the bare number read as a process the listing had just made.
  - @fnndsc/calypso@0.16.2

## 0.3.1

### Patch Changes

- Updated dependencies [dac2d96]
- Updated dependencies [dac2d96]
- Updated dependencies [50f8a4e]
- Updated dependencies [c82f514]
  - @fnndsc/chell@5.9.1
  - @fnndsc/menu@0.11.0
  - @fnndsc/calypso@0.16.1

## 0.3.0

### Minor Changes

- b58f4da: porter: published. `npm install -g @fnndsc/porter` brings the whole stack beneath it, and `PORTER_CUBE_URL=… porter` is the full login experience from one install. `@fnndsc/menu` is a declared dependency, since the greeter serves its brain and ANSI modules from where menu is installed.

### Patch Changes

- 2b18178: porter: `porter --status` asks for nothing but the state directory. It read the full configuration first and refused without `PORTER_CUBE_URL`, a fact a listing never uses.

## 0.2.0

### Minor Changes

- 3a8cd1b: A porter at the door: the mise display manager, slice 3 — the shape without the door.

  `apps/porter` logs an operator into one CUBE, trades the password for a token, starts or joins that identity's calypso (`chell --daemon --auth-token-stdin`, the token on stdin, four directories of its own under the porter's state) and mounts the session at `/s/<key>/`: page, assets, `/vfs` and the WebSocket wire proxied to the daemon on loopback with the attach token added by the porter, so the browser holds none. `GET /boot/<key>` streams the session's boot as server-sent events, one per line the daemon wrote, replayed for a late attacher. `POST /sessions` re-checks the password at CUBE every time, even when the session is up.

  calypso: the attach token may ride the upgrade URL (`?token=`), the way `/vfs?token=` already does, so a front that holds the token for a browser can put it on the proxied upgrade and the page attaches with an empty one; and `berth_pathIn(runtimeDir, identity)` names a berth under a runtime directory that is not the process's own.

  No cookie yet: this porter binds loopback. The door — login page, cookie, LOG OUT — is the next slice.

- 4ee180c: A session outlives its door: the porter's lifecycle.

  porter: a restarted porter adopts the sessions its predecessor started, from their berths under the state directory, rather than starting rivals. Idle sessions — no wire open, nothing through the door for `PORTER_IDLE_HOURS` (a day, like the cookie) — are ended by a sweep every minute: the process only; the state directory stays and the next login boots warm. `porter --status` lists the state directory's sessions and whether each answers. `deploy/` carries a systemd unit (a `porter` user, `KillMode=process` so a stopped door keeps its sessions), an env file example, and a Caddyfile for TLS in front. Boot lines kept per session are capped at 2000.

  calypso: a berth records the daemon's pid, so a host that did not start a daemon can still end it.

  chell: a daemon off a TTY tolerates EPIPE on its stdout and stderr — the porter that started it may stop first, and a session outlives its door.

- 21f8d21: The door itself: the porter logs a browser in and argus leaves by the door it came in.

  porter: `GET /login` asks for a username and a password; `POST /login` (form or JSON) trades the password for a CUBE token, starts or joins the session, sets a signed HttpOnly SameSite=Lax cookie naming it (Secure behind TLS, a day long by default) and sends the browser to `/s/<key>/?door`. The cookie gates the boot stream, the mount and the wire: a browser reaches only the session its cookie names; without it, the door (302), a refusal (401) or a dropped upgrade. `POST /logout` clears the cookie and leaves the session running. `PORTER_SECRET` signs the cookie; given none, one is made up per start and said so.

  argus: a LOG OUT pill beside AUDIO and the theme, in the frame's hue, standing only on a page that came through a door; pressed, it tells the door to forget this browser and goes to the door's login. The session is not touched. Law: a-surface-leaves-by-the-door-it-came-in.

- 1c169d7: The greeter: the door answers at once, and a boot is watched rather than waited for.

  porter: `POST /login` no longer holds the browser for a cold boot. A session already up is entered directly; one that must boot sends the browser to `/greet/<key>`, where the mise brain wakes — the same frames a terminal boot draws, paced by the page — and the daemon's boot rows arrive beneath it as they are written, ANSI and all, from the boot stream. `ready` rests the brain and hands the browser to the session; `failed` says why and offers the door again. The login page wears the same shell with the brain at rest. The porter serves the two modules it draws with from the installed wire package (`/greeter/brain.js`, `/greeter/ansi.js`); a booting identity is pending in the registry and reaches its mount only when its berth answers.

  menu: `@fnndsc/menu/ansi` — the ANSI-to-HTML converter and the console palette, moved from the ARGUS console so a browser greeter renders a boot the way the console renders a transcript; argus keeps the DOM half and re-exports the rest.

### Patch Changes

- Updated dependencies [d1a1c0d]
- Updated dependencies [3a8cd1b]
- Updated dependencies [1bdf876]
- Updated dependencies [4ee180c]
- Updated dependencies [c1178a0]
- Updated dependencies [5b520c7]
- Updated dependencies [810f3ba]
- Updated dependencies [7bba167]
  - @fnndsc/calypso@0.16.0
  - @fnndsc/chell@5.9.0
