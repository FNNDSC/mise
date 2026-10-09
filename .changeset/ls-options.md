---
"@fnndsc/brasa": patch
---

Listing afresh lists the path named, and ls refuses an option it does not have by name (#1024, #1025). `--refresh` and `--reverse` are switches, so the word after one had been taken as its value and the working folder listed instead. `ls -R` had been ignored without a word; it now answers `ls: invalid option -- 'R'`, as does any other option ls lacks. A `--sort` value outside name, size, date and owner is refused rather than ignored. `-a` and `-A` are taken: nothing in a listing is hidden.
