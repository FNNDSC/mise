---
"@fnndsc/argus": minor
---

ARGUS: a CSV opens as the table it is.

A delimited file opened as a `pre` of quoted lines. It now opens as a listing: the header record becomes the caps, the records become rows, and it gets the frame, the sort and the filter every other listing has. RAW stands beside CLOSE for when the quoting is the thing being read.

The file is read rather than split. A field may carry the delimiter, a newline or a doubled quote, and splitting on commas turns one such row into several wrong ones; `.tsv` is read by its tabs. A first record that is not a header — a blank, a repeat, or a bare number among its cells — is kept as data with the columns numbered, since inventing names out of values would hide a row. A ragged record is filled rather than refused.

The view is bounded at five thousand records and says so when the bound bites.
