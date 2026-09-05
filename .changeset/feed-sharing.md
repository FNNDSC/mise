---
"@fnndsc/cumin": minor
"@fnndsc/brasa": minor
---

feat(share): sharing a feed is a kernel capability, not a surface's private errand

An exemplar needed to share a feed and mise had no wrapper for it, so it reached past the stack to CUBE's REST directly. That reasoning is backwards: a missing wrapper is the work, not a licence to route around it. A capability living in one caller's private REST call is invisible to every other surface, untested by the kernel's suite, and silently duplicated by the next person who needs it.

The kernel gains `feed_share` and `feedShares_list`, over the client's own `addUserPermission` and `getUserPermissions` — which existed all along, so no raw REST was ever needed anywhere. brasa exposes them as `share`:

```
share feed_12 with someone     # grant
share feed_12                  # who holds it
```

A feed can be named by id, by the `feed_N` a listing shows, or by any path holding one — so a path under `/SHARED` resolves by the same rule as one under a home folder. The grammar sits in its own dependency-free module, as `cat`'s does, because a grammar buried in a builtin is a grammar nothing can test here.

The exemplar now goes through the stack, which is the point: it proves something a surface can actually do.
