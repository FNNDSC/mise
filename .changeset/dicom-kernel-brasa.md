---
'@fnndsc/brasa': minor
---

New `dcm` builtin: `dcm series <folder>` renders a folder as a series and carries the `dicom.series` model; `dcm tags <file|folder> [--all] [--filter <text>]` renders a grouped tag listing, or a folder's constant and varying tags, and carries `dicom.tags`. Folder listings read every file up to 512 then sample evenly, and the text says how many were read of how many, and which were refused.
