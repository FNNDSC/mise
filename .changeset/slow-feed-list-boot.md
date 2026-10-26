---
"@fnndsc/cumin": patch
"@fnndsc/salsa": patch
"@fnndsc/brasa": patch
"@fnndsc/chell": patch
---

An identity that sees thousands of feeds can log in again: the boot no longer waits on CUBE's slow feed list (#1280). The token check reads `users/` instead of the API root, which is the feed list and took up to 22 s for `chris`; a CUBE that does not answer the check is said to be silent, never to have refused the token. Each client reads its root once for every caller, and feed-list pages wait 120 s instead of chrisapi's 30. A cold boot walks the feed index behind the listening daemon, as a restored one already did, so the session answers the door before its 120 s wait runs out; a `/proc` read that arrives first joins the walk instead of starting a second.
