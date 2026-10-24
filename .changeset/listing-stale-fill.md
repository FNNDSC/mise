---
"@fnndsc/salsa": patch
"@fnndsc/cumin": patch
"@fnndsc/brasa": patch
---

A folder you just removed no longer comes back in `ls`. CUBE accepts a folder's removal (202) and finishes it a moment later; until then its parent still lists the folder, and a listing read in that moment (the `ls` after `rm -r`, a pane's refresh) was kept as current, so the removed folder stood in `ls ~` for as long as the cache trusted that listing.

`rm -r` and `rmdir` now return once CUBE has finished: they wait, 15 seconds at most, for the parent to stop naming the folder, and say so in words if it still does (`CUBE accepted the removal of … but still lists it after 15s`).

The listing cache also no longer keeps a listing that a change overtook while it was being read. A read takes a stamp before it asks CUBE (`stamp_take()`), and `cache_set(path, data, { since })` does not keep a listing whose folder, a tree above it, or the whole cache was invalidated after that stamp. brasa's VFS takes the stamp for an `ls` and for the refresh behind a stale one.
