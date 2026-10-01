---
"@fnndsc/cumin": patch
---

One folder lookup per path per session: `filebrowser/search?path=` is memoised through the listing cache (shared in flight, a miss never kept, dropped by the same invalidations the listings get), so a navigation no longer asks CUBE three times for the same path.
