---
"@fnndsc/brasa": patch
---

A pipeline can be named by its own name, not only its `/bin` name, in `gather process` and at the prompt. The `/bin` name carries the CUBE id (`…_id291`), so a manifest that used it ran on one CUBE only; `gather process "FreeSurfer 8.2.0 mri_convert per series, DICOM"` now runs on any CUBE that has the pipeline (#1226).
