---
"@fnndsc/stratus": minor
---

A Trusted Domain found in the tenancy is shown as the cloud says it, before anyone adopts it; an adopted one can be torn down; a teardown removes what carried the domain's tag.

Found domains (docs/stratus.adoc, D15) used to read FOUND · NOT ADOPTED with no address, no spec, no steps and STOPPED, whatever their state, until `domain adopt`: through porter every user but the builder saw every domain that way. Now `domain status` reads each found domain from the cloud: its address and spec from its stack's variables, its condition from what lives in its compartment and what the stack still holds (UP, STOPPED, or GONE when nothing is left but its tag), its steps as far as the cloud attests them. Adoption stays what `plan`, `verify`, `build` and `teardown` wait on.

A found domain with nothing left of it but its tag takes `domain teardown <name>` without an adoption: nothing a lock would keep. An adopted domain is torn down as a built one is, once `domain protect <name> off` has been said and the name is typed back; it used to be refused by name.

A teardown now also removes the stack itself (it carried the tag, so the domain was found again), any block volume left in the domain's own compartment with the attribution tag, and the compartment with the image bucket in it when stratus made them (`domains/<name>`); a compartment that is not stratus's keeps itself and loses the tag. A domain with no zone known has no records looked for.
