---
"@fnndsc/menu": minor
"@fnndsc/brasa": minor
---

feat: a PACS question can be put to several servers at once

`--pacsserver a,b` asks each named server and unions the answers into one listing. It is the same fan-out a cohort uses, discriminated by a different column: SERVER rides every study and every patient row, so two answers can be told apart, sorted and filtered.

**A row names its server only when more than one could have answered.** On a single-server query the column would repeat one value down the page and tell an operator nothing.

**There is no sweep-everything.** The CUBE this was designed against carries thirteen registered servers, several reading as one-off or per-person registrations; an `--all` would mean thousands of C-FINDs mostly into endpoints of unknown liveness. A fan-out is always something the operator named.

**A server that could not be reached is `unasked`, not empty.** Verified live: naming a server that does not resolve leaves that row `—` with its reason while the server that did answer still reports what it found. A server that could not be reached has told us nothing about that patient; rendering it as a zero would say the opposite.

The reason on such a row is stripped of the error stack's debugging prefix where it becomes model data, since it is read in a terminal table and on a graphical surface alike.

Servers are keyed by their canonical identifier — what CUBE files a query under, and therefore what the replay index matches on, so a question already asked of one server replays while the same question to another is asked fresh.
