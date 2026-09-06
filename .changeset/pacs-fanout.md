---
"@fnndsc/brasa": minor
"@fnndsc/chell": minor
---

feat: a PACS question that names several patients becomes several questions

A PACS will not match a list. `PatientID:4356325\4433255` — the DICOM multi-value form — returns nothing from a real PACS, and the standard agrees: *List of UID Matching* is defined only for attributes whose VR is `UI`, and `PatientID` is `LO`. So asking after two hundred MRNs is two hundred C-FINDs, and the fan-out is forced rather than chosen.

**The inline comma list is the operator's own syntax, now accepted.** `query PatientID:1234,4532,6654` is three questions and one table; `query PatientID:1234,StudyDate:20240101` still means what it always meant. There is nothing to disambiguate — every genuine term carries a colon, so a bare segment can only be another value for the key before it. Several multi-valued keys fan out over their cross-product, and above 32 the command refuses by name rather than launching hundreds at a shared clinical system.

**`--patients <list|@file>` carries a real cohort.** `@file` names a file in ChRIS storage, read through the session's own path and never the engine's host disk, so the flag behaves identically from a local shell, a remote shell and a browser — and a list on somebody's laptop reaches it through `upload`, the gated door. One MRN per line; blanks and `#` comments ignored.

**Four questions in flight**, in one constant. Not operator-settable: nobody inside mise knows the right number for a given hospital, and a flag that can hurt a shared clinical system will eventually be set to 50.

**A failure is not a miss.** A question that could not be asked is recorded `unasked` with its reason, never as zero studies. A server that timed out has told us nothing; a PACS that answered with nothing has told us something, and a clinician acts on the difference. The table says `FOUND 2 · NONE 1 · UNASKED 0`, and the model carries every row.

**Replay applies per patient**, so a cohort's already-asked MRNs never leave the building — verified live against rows answered eight months ago.

Two things found live while proving it:

* **CUBE refuses a second PACSQuery with a title it already holds for that server.** A fan-out under one title had every question after the first come back `You have already registered a PACS query with title=…`, which a less careful client would have rendered as "no imaging". Each question now carries its own title. Recorded in `docs/CUBE-gaps.adoc`.
* **`chell -c` and `chell -f` had no replay at all.** A one-shot skips the boot warm-up — correct — but that left the replay index neither restored nor written, so a scripted cohort re-asked the PACS every single time, and the audit workflow the fan-out exists for was the one workflow replay never reached. A one-shot now primes the index from the checkpoint a previous run paid for, and flushes what it learned before exiting, since the debounced writer's timer never fires in a process that short.
