---
"@fnndsc/cumin": patch
"@fnndsc/brasa": patch
---

A folder you just removed no longer comes back in `ls`. A listing that was being read from CUBE when an `rm`, an upload or a move changed the folder brought back the folder as it was, and the cache kept it: `ls ~` could show a folder `rm -r` had removed, for as long as the cache trusted that listing.

The listing cache now counts invalidations. A read takes a stamp before it asks CUBE (`stamp_take()`), and `cache_set(path, data, { since })` does not keep a listing whose folder, a tree above it, or the whole cache was invalidated after that stamp. brasa's VFS takes the stamp for an `ls` and for the refresh behind a stale one.
