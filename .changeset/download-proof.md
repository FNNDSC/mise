---
"@fnndsc/argus": patch
---

The DOWNLOAD smoke proves what ARGUS owns (#830): the name and bytes the page hands the browser to save, and nothing handed over for a file the session cannot read; headless Chromium saves no download at all, so the disk proved nothing about the surface. The smoke driver's CDP calls now reject with the method and the browser's words when refused, instead of resolving as if they had worked.
