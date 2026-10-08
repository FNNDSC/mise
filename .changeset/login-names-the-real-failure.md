---
"@fnndsc/cumin": patch
"@fnndsc/chell": patch
"@fnndsc/porter": patch
---

A failed login now says what failed, instead of always blaming the credentials. An untrusted TLS certificate names the host, the code and `NODE_EXTRA_CA_CERTS`; an unreachable CUBE says so with the code; only CUBE refusing the login mentions the password. The same holds for token logins, `sudo`, and porter's login page.
