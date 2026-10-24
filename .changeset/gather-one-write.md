---
"@fnndsc/brasa": patch
---

Gathering a series answers in about six seconds instead of ten: `gather add` writes the cohort once. It asked CUBE where the series landed after writing the cohort file and then wrote it again; now it asks first and writes once with the folders in it. Every gather verb also stops asking CUBE to make `~/gather` each time once the folder is known to be there, which saves about a second each.

A cohort write CUBE does not take is now refused (`gather: could not write …`) instead of being passed over. A write that fails because `~/gather` has gone since makes the folder again and writes once more.
