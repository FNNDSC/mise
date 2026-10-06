---
"@fnndsc/chell": minor
---

Log in at a porter once and let scripts through after, the way `gh auth login` works. `chell auth login` keeps a door token: by default a one-time code entered on the door's login page from any device, so the password never crosses the terminal; `--with-password` types it here for a door no browser can reach; `--with-token` pastes a token minted elsewhere. The token lives in `~/.config/chell/doors/<door-host>.json` at mode 0600 and is refused by name when the file is loose. `chell auth status`, `logout`, `token` and `tokens` round it out, and `chell --remote --door` uses the token when it has one, never over plain http to another host.
