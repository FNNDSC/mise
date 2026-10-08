---
"@fnndsc/porter": patch
---

porter installed from npm now starts instead of exiting silently. That covers its `porter` bin link, `npx porter` and `node_modules/.bin/porter`. It used to decide whether it was the program by checking that `argv[1]` ended in `porter.js`; it now compares real paths, as chell and calypso do.
