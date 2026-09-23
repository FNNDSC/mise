---
"@fnndsc/chell": patch
---

chell: `--door` shows its "Username at …" question. The label was written beside readline's empty prompt, and readline's repaint erased it, so the question looked like a blank line. An empty answer is now refused by name instead of reaching the door as a login for nobody.
