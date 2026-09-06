---
"@fnndsc/brasa": patch
---

test: a live exemplar proves a cohort answers for every patient asked

Exemplar 11 drives the whole PACS plural path through `command_dispatchEnvelope` — the same entry chell uses — against a live CUBE and a real PACS.

What it pins, in the order an operator would care:

* **Every MRN asked has a row.** It counts rows, not hits: the answer an audit wants is usually the patients a hit-list would hide.
* **Replay applies per patient.** The second ask of the same cohort is served from stored answers for the patient with imaging — same query id, provenance saying so — while the rows that found nothing are asked again, because an absence decays where a hit does not.
* **A failure is not a miss.** Asked of a server CUBE does not register, the rows read `unasked` with a readable reason rather than zero studies. This is the property that needs a live PACS: a mock would only agree with whatever the code already does.
* **The CSV round-trips.** `--csv-to` writes into CFS, `cat` reads it back, every row carries the same ten columns, and the misses are in the file.

It needs no new fixture: the designated test accession names a study, that study names a patient, and that patient is the MRN known to have imaging. Every PACSQuery the run creates is deleted and the file removed, so the CUBE ends as it began. Self-skips with exit 2 where no PACS fixture is configured, and joins the nightly e2e list.

One fix it drew out: the query model named its server with the raw `--pacsserver` argument, so a table asked with `--pacsserver 1` reported the server as `1`. The model now carries the canonical identifier CUBE files queries under, which is what `PACSDCM` means to an operator reading a CSV.
