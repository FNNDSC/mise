---
"@fnndsc/cumin": minor
"@fnndsc/brasa": minor
---

feat(acl): a feed's access list, in the shell's own verbs

An exemplar needed to share a feed and mise had no wrapper, so it reached past the stack to CUBE's REST. That is backwards: a missing wrapper is the work. A capability living in one caller's private REST call is invisible to every other surface and untested by the kernel's suite.

The kernel gains `feed_share` and `feedShares_list`, over the client's own `addUserPermission` and `getUserPermissions` — which existed all along, so no raw REST was ever needed.

Its shell face is `setfacl` and `getfacl`, not a `share` verb. Granting an identity access to a thing is an access control entry, and that is a verb a terminal already knows; "share X with Y" is a sentence, and reads as a natural-language assist rather than a shell:

```
setfacl -m u:someone:r /home/me/feeds/feed_12
getfacl /home/me/feeds/feed_12
  # file: home/me/feeds/feed_12
  user::rw-
  user:someone:r--
```

A feed is named by id, by the `feed_N` a listing shows, or by any path holding one, so a path under `/SHARED` resolves by the same rule as one under a home folder. Group and other entries are refused rather than quietly read as users, an entry granting no read is refused because reading is what a CUBE share conveys, and `-x` is refused **by name** — CUBE models the grant but mise has no revocation to offer, and a shell that appears to strip an entry it cannot strip is worse than one that says so.

The grammar sits in its own dependency-free module, as `cat`'s does: the engine graph cannot be loaded under jest, so a grammar inside the builtin is a grammar nothing tests.
