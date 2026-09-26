---
"@fnndsc/menu": minor
"@fnndsc/brasa": patch
"@fnndsc/salsa": patch
"@fnndsc/argus": patch
---

`proc universe` carries what each feed's data is (`data`: format, and for DICOM modality and series description) once the index has read it. The reader follows a copy job's links (to files and to folders), reads newest feeds first, four at a time, gives a feed that never answers 45 s before moving on, records a DICOM-named file whose header will not read as DICOM with the reason, and stamps each record with its reader's version so a better reader reads feeds again.
