---
"@fnndsc/porter": patch
---

porter: `porter --status` asks for nothing but the state directory. It read the full configuration first and refused without `PORTER_CUBE_URL`, a fact a listing never uses.
