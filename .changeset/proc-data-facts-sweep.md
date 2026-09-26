---
"@fnndsc/salsa": minor
"@fnndsc/chell": patch
---

The /proc index reads what each feed's data is, once: from the first file its root job made (by name, descending into a folder), the format, and for DICOM the modality and series description from one header read. It runs after the topology sweep, as each feed's topology loads, and after a checkpoint restore; what cannot be known yet is tried again, what is known to be absent is recorded with its reason.
