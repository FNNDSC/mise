---
"@fnndsc/salsa": patch
"@fnndsc/chili": patch
---

salsa: a touch carrying content REWRITES the file it finds.

CUBE's upload does not replace. Uploading over a path that already held a file left the OLD content in place and still reported success, so anything written to the same path twice kept its first version forever — the surface's own cohort file was written on every change and had not changed since the first one. Content given for a path that already exists is a rewrite: the file there is removed first, and a removal that fails is reported instead of written over.

chili's readout was the second half of the same lie. A touch that carried content now says it WROTE the file rather than created it, so replacing an operator's file never reads as making a new one.
