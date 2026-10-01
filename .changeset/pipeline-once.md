---
"@fnndsc/cumin": patch
---

A pipeline is resolved once per session: `pipeline_resolve` keeps its answer on the connection's client (by the specifier asked, the name and the id), the chrisapi item a search or a get served is kept beside it, and `pipeline_get` reads the pipings off that item instead of listing the pipeline again — a `pipeline diagram` costs at most three requests the first time (the id, the pipings, the defaults) and none the second; a /bin slug (`<base>_idN`) is resolved by its id outright instead of a name search that always missed and then the id as a fallback.
