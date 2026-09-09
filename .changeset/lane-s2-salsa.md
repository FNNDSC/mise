---
"@fnndsc/salsa": minor
---

fix(salsa): `proc refresh <feed>` keeps the feed's roster row and evicts only its topology — a feed seen through the public listing is not in the own-feeds endpoint, and a refresh that removed the row and could not re-read it left the feed "not found" after its re-walk; the row is re-read from the own feeds, then the public ones
