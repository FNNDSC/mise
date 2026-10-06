---
"@fnndsc/porter": minor
---

The porter's own command line lists, revokes and mints door tokens. `porter --tokens` shows user, name, minted, dies and last used; `porter --revoke <user> [<name>]` ends one or all of a user's; `porter --mint <user> --name <name>` mints one by the operator's hand, shown once, for a service identity or a hand-over. A running door notices a store changed under it on the token's next use, so a revocation takes effect without a restart.
