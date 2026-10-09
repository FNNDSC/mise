---
"@fnndsc/brasa": patch
---

A redirected listing numbers its rows: after `ls ~ > listing.txt`, `cd @DIR1` goes where it would after `ls ~`. The rows go to the file and the terminal shows the usual "from: ls ~ · 25 rows" readout, so an index never refers to rows nobody was told about. Pipes are unchanged: what a pipe shows is filtered, so its rows are not numbered.
