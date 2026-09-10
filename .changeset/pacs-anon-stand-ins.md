---
"@fnndsc/salsa": minor
"@fnndsc/brasa": minor
---

`pacs query --anon` stands in for what an answer says about a person, for demonstrating against a live hospital PACS. Record numbers and accessions become salted tokens, a name becomes a stand-in name of the same DICOM shape, a study date falls back to the first of its month and a birth date to its year. The substitution happens on the decoded payload, so the model a surface renders, the console table and any CSV all say the same thing. The salt is made once per daemon and never written down, which makes tokens stable through one demo and meaningless after it: an unsalted digest of a seven-digit record number is a second's work to reverse. DICOM identifiers are left alone, since they are never shown and are what the held-state reconciliation matches on.
