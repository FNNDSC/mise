---
"@fnndsc/argus": patch
---

The feed roster settles itself. It asked a flex-laid-out element whether it was `block`, so it never re-asked the session: a finished run read RUNNING forever, a cwd inside a feed painted its graph over the roster, and an arriving feed that was not listed prompted no look. The roster now holds its own shown state and re-asks every ten seconds while a listed feed is live, falling back to a minute once every row is terminal.
