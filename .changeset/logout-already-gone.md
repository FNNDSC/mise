---
"@fnndsc/chell": patch
---

Logging out of a door no longer warns about a token that is already gone. When `chell auth logout` finds the door no longer knows the token (a newer login under the same name replaced it, or it was revoked), it says there is nothing to revoke. It no longer suggests revoking by name, which would have reached the newer login.
