# ARGUS

ARGUS is an LCARS-based web console and terminal surface for mise. It is one possible ChRIS user experience, not the canonical or exclusive UI.

ARGUS attaches to a CALYPSO session and presents an indwelling terminal surrounded by graphical instruments. Those instruments organize the operational domain into Files, Runs, Tools, Sources, and Compute. They consume CALYPSO's public wire contract and do not speak directly to CUBE or `chrisapi`.

The first implementation increment is live: the LCARS frame, the terminal as a retractable drawer attached over the wire, and the Files instrument repainting from `fs.listing` envelope models. Typing `ls` in the terminal updates the Files panel as data, and activating a directory row in the panel lowers to the same `cd` and `ls` commands an operator could type. Two projections of one session, in both directions.

## Running the demo

First fetch the LCARS theme: download `LCARS-26.zip` from [TheLCARS.com](https://www.thelcars.com/download.php) into `~/Downloads` (or point `LCARS_ZIP` at it). The theme is EULA-restricted and never committed here; the build extracts it locally, and falls back to a plain generated stand-in when the zip is absent.

Then build the workspace from the repository root and start a daemon from that same root:

```sh
npm install
npm run build
node packages/chell/dist/index.js <user>@<cube-url> -p <password> --daemon
```

The daemon serves the built ARGUS bundle from the same loopback port as the wire and prints the URL to open, token included:

```
[+] ARGUS web surface at http://127.0.0.1:<port>/?token=<token>
```

The bundle is discovered from `apps/argus/dist` relative to the daemon's working directory; set `CALYPSO_WEB_ROOT` to serve a bundle from anywhere else. Without a token in the URL, the page offers a paste form. During UI development `npm run dev -w @fnndsc/argus` starts a Vite dev server; pass `?ws=ws://127.0.0.1:<port>` to point it at a running daemon across origins.

## Structure and boundaries

See [docs/architecture.adoc](docs/architecture.adoc) for the approved structure and [the mise-level ARGUS design](../../docs/argus.adoc) for its place in the wider system, including the LCARS licensing position (the genuine Lower Decks theme is materialized per machine from the author's own download, never redistributed from this repository). The forward design for local IDE, filesystem, terminal, and workspace capabilities is recorded in [docs/operator-companion.adoc](docs/operator-companion.adoc).

This package is a private workspace member: it rides the monorepo's install, build, and CI, and is never published to npm. Browser code imports only `@fnndsc/calypso/protocol`, the published wire contract; the execution stack stays out of the bundle by rule.
