---
"@fnndsc/argus": patch
---

ARGUS ships the LCARS sounds. The four beeps (press, arrive, retreat, refuse) are committed as `public/sounds/*.mp3`, so every install plays them; the synthesised `.wav` remain only as the fallback for a missing `.mp3`. Previously they were extracted per machine and a published install fell back to the synthesised beeps.
