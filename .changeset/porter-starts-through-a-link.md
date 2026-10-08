---
"@fnndsc/porter": patch
---

porter now starts when run as installed by npm, through its `porter` bin link, `npx porter` or `node_modules/.bin/porter`, instead of exiting silently. It used to decide whether it was the program by checking that `argv[1]` ended in `porter.js`; it now compares real paths, as chell and calypso do.
