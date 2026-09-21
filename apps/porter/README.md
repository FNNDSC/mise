# @fnndsc/porter

PORTER is the mise display manager — gdm to ARGUS's desktop. It logs an operator into one CUBE, finds or starts their calypso session on this host, and shows their browser to ARGUS under `/s/<key>/`, holding the attach token so the browser never does.

Design log: [`docs/porter.adoc`](docs/porter.adoc).

```sh
PORTER_CUBE_URL=https://cube.example.org/api/v1/ porter
curl -s -X POST localhost:4180/sessions -H 'content-type: application/json' -d '{"username":"chris","password":"…"}'
curl -N localhost:4180/boot/<key>
open http://localhost:4180/s/<key>/?door
```

Not published; runs from a checkout or an image.
