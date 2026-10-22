---
"@fnndsc/brasa": minor
---

One line runs a plugin or pipeline over the whole cohort, and `expect gather unpulled eq 0` says every member landed. `gather process` makes one feed whose root holds every member's landed folder (the cohort's own feed when it has one) and runs off that root; the name resolves as `/bin` resolves it, a series not pulled yet refuses by name, and it answers what the bare run would, so `R=$(gather process pl-dcm2niix-v1.0.2)` then `${R.outputPath}` (#1208).
