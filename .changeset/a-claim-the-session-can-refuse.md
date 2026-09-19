---
"@fnndsc/brasa": minor
---

brasa: `expect` — a claim the session can refuse.

A workflow that only acts is a demonstration. `expect` is what makes one a test: it states a claim about the session and refuses, non-zero, when the claim does not hold. Because it is a verb rather than a harness, a workflow asserts wherever it is played — in CI, at a console, or in someone else's browser after they were handed the file.

`expect gather size eq 14`, `expect feed 4599 status eq finishedSuccessfully`, `expect run 601152 status eq finishedSuccessfully --within 20m`, `expect path <p> count --matching '*.nii*' gt 0`, `expect path <p> tags PatientID eq anon-001`. Comparisons are `eq`, `ne`, `gt`, `gte`, `lt`, `lte`, `contains`, `notContains` and `matches`.

Time lives in this verb and nowhere else: `--within` keeps asking until the claim holds or the deadline passes, which is why no other verb needs a timeout and why the language has no sleep — a sleep asserts nothing and lies about how long the work took. A failed claim prints what it wanted, what it got, and how long it waited.

Two decisions worth naming. A subject that cannot answer — a feed this session has never indexed, a path holding no readable DICOM — is reported as NOT KNOWING rather than as a false claim, because those are different facts. And a DICOM tag that varies across a folder answers with every value it takes, so a claim about "the" value cannot pass by reading only the first file; that is what makes the tag check an honest proof that an anonymization ran.

Third slice of the manifest work (`docs/manifest.adoc`).
