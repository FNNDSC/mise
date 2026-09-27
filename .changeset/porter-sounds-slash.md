---
"@fnndsc/porter": patch
---

`PORTER_SOUNDS_DIR` actually answers: the mount hands the route `/sounds/press.mp3` with its leading slash, which the sound match did not allow, so every sound was proxied to the page's own. Route-level test added.
