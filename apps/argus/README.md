# ARGUS

ARGUS is an LCARS-based web console and terminal surface for mise. It is one
possible ChRIS user experience, not the canonical or exclusive UI.

ARGUS attaches to a CALYPSO session and presents an indwelling terminal
surrounded by graphical instruments. Those instruments organize the operational
domain into Files, Runs, Tools, Sources, and Compute. They consume CALYPSO's
public wire contract and do not speak directly to CUBE or `chrisapi`.

The application is currently an architectural scaffold. See
[docs/architecture.adoc](docs/architecture.adoc) for the approved structure and
[the mise-level ARGUS design](../../docs/argus.adoc) for its place in the wider
system.
