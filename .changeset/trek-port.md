---
"@fnndsc/brasa": minor
---

New `trek` command: the 1976 Berkeley space war game, played by question in the console or a terminal. It is a line-by-line port of NetBSD's trek(6). Fixed seeds give the same transcript as the original C built with glibc's random(); the tests replay 18 recorded games byte for byte. The short and long range scans show glyphs and colours, and `--classic` shows them as originally printed. `-f`, `-s` and `--seed N` are also accepted. `dump` keeps the game in the session and a `restart` length brings it back. One change from the original: when a starbase is caught in a nova, the C passed sector coordinates to killb() as a quadrant's and read past the galaxy array; the port destroys the base in the current quadrant instead. The UC Berkeley licence and the original credits are in brasa's NOTICE.
