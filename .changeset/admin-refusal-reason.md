---
"@fnndsc/cumin": patch
---

An admin request CUBE refuses now says why. Admin POSTs are sent directly rather than through chrisapi's request helper, which replaced any non-Collection+JSON error body (Django REST field errors, Django's HTML error pages) with "Bad server response!". The refusal reads `CUBE refused POST <url> (HTTP <status>): <CUBE's own words>`, from field errors, a `detail`, a Collection+JSON error, or the text of an HTML page.
