---
"@fnndsc/argus": patch
---

A dropped slice is asked again: slices load eight at a time, each refused one is retried three times with a growing pause, one with no answer in 30 s counts as refused, and whatever is still refused puts RETRY n on the image frame to ask again for just those.
