---
"@fnndsc/argus": minor
---

The TD controller and the dashboard say Trusted Domain, and show a found one as the cloud says it.

DOMAINS is now TRUSTED DOMAINS on the tile, the controller's header, its stage, its log and its command labels. The tile counts the Trusted Domains that stand and, apart, those with nothing left of them (`1 GONE`); a found domain's row carries its condition.

On the controller a found Trusted Domain shows its address, its spec and its steps as far as the cloud attests them, with ADOPT first on OVERVIEW. One with nothing left but its tag reads FOUND · NOTHING LEFT, says what is left (its compartment and what it holds, its stack), has no lock, and offers REMOVE WHAT IS LEFT on OVERVIEW and TEARDOWN. The TEARDOWN view lists what a teardown now also removes: the stack itself, and the domain's own compartment with its image bucket.
