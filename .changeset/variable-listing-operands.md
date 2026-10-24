---
"@fnndsc/brasa": patch
---

A variable holding a listing expands as a pipe hands it on: `gather add ${T1}` gets the series a grep kept. It used to add every patient and study row the grep kept as context, so `gather add` and `pull` took whole studies the grep had removed (#1226).
