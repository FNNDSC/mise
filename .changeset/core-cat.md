---
"@fnndsc/brasa": patch
---

Nothing changes at the prompt: cat reads through the backend's filesystem, not chili (#1001). Text goes through the filesystem's `read` and binary files through `readBinary`. A refusal prints the mount's own words, so CUBE's "File not found …" and each mount's refusal read as before. Highlighting, binary detection and the `/etc/group` progress are unchanged.
