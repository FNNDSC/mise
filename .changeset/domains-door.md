---
"@fnndsc/argus": patch
"@fnndsc/stratus": patch
---

Pressing the DOMAINS tile now opens the TD controller, and an adopted domain shows the ChRIS steps it already did.

Before, the tile opened the files listing, so the controller could only be reached by typing `domain`. An adopted domain read as unfinished because adoption carried only the machine's steps. Adopting a domain again catches it up from its checkout.
