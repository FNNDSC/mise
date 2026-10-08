---
"@fnndsc/brasa": patch
---

A PACS request CUBE refuses now says so and names the pacs_users group, instead of `pacs list` reporting no servers. `pacs list`, `pacs query` and a cohort query whose every question was refused add who grants PACS access; `group adduser` notes that a CUBE taking its groups from a directory (Authentik, LDAP) undoes the add at the user's next login, and the sudo hint now recognises CUBE's "You do not have permission" wording.
