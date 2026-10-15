---
"@fnndsc/brasa": patch
---

A query now warns when the PACS ignores part of what you asked. PACSDCM answers `SeriesDescription` and `StudyDescription` as if they were not there, so `query PatientID:…,SeriesDescription:*T1*` returns every series; the query still runs as asked, and one line points at the grep that narrows it (`… | grep -i -e 'T1'`). Each server's ignored keys can be set in `~/.config/mise/pacs.json`.
