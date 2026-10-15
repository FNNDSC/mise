---
"@fnndsc/chell": patch
---

`chell auth logout` no longer warns about a token that is already gone. When the door no longer knows the token (a newer login under the same name replaced it, or it was revoked), logout says there is nothing to revoke. It no longer suggests revoking by name, which would have reached the newer login.
