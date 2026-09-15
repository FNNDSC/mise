---
"@fnndsc/argus": patch
---

The console input is regular weight, not bold — it smeared at that size and read as out of focus. And the voice can be the original TheLCARS.com beeps again: `scripts/sounds_import.mjs` materializes them from the operator's own LCARS-26.zip into `public/sounds/` (gitignored, because the template's EULA forbids redistribution), and each sound prefers the original `.mp3` with the committed synthesised `.wav` as the fallback, so a clone without the zip still has a voice. Sounds moved to `public/` so the browser can fall from one source to the next.
