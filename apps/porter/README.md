# @fnndsc/porter

PORTER is the mise display manager — gdm to ARGUS's desktop. It logs an operator into one CUBE, finds or starts their calypso session on this host, and shows their browser to ARGUS under `/s/<key>/`, holding the attach token so the browser never does.

Design log: [`docs/porter.adoc`](docs/porter.adoc).

```sh
PORTER_CUBE_URL=https://cube.example.org/api/v1/ porter
open http://localhost:4180/login          # the door: log in, land on the session
curl -s -c jar -X POST localhost:4180/login -H 'content-type: application/json' -d '{"username":"chris","password":"…"}'
curl -b jar -N localhost:4180/boot/<key>
```

Not published; runs from a checkout or an image.
