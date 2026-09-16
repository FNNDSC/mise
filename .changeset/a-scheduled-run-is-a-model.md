---
"@fnndsc/brasa": patch
---

A scheduled run answers with a typed model. Running a plugin from the shell now returns a `run.scheduled` envelope model (the executable, the instance, the feed it landed in, whether that feed is new, the output path) beside the lines it already printed, so a surface can point at what it started rather than parse the console.
