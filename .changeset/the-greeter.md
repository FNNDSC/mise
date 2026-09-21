---
"@fnndsc/porter": minor
"@fnndsc/menu": minor
"@fnndsc/argus": patch
---

The greeter: the door answers at once, and a boot is watched rather than waited for.

porter: `POST /login` no longer holds the browser for a cold boot. A session already up is entered directly; one that must boot sends the browser to `/greet/<key>`, where the mise brain wakes — the same frames a terminal boot draws, paced by the page — and the daemon's boot rows arrive beneath it as they are written, ANSI and all, from the boot stream. `ready` rests the brain and hands the browser to the session; `failed` says why and offers the door again. The login page wears the same shell with the brain at rest. The porter serves the two modules it draws with from the installed wire package (`/greeter/brain.js`, `/greeter/ansi.js`); a booting identity is pending in the registry and reaches its mount only when its berth answers.

menu: `@fnndsc/menu/ansi` — the ANSI-to-HTML converter and the console palette, moved from the ARGUS console so a browser greeter renders a boot the way the console renders a transcript; argus keeps the DOM half and re-exports the rest.
