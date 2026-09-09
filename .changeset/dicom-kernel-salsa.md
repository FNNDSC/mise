---
'@fnndsc/salsa': minor
---

DICOM in the kernel: `dicomTags_read` parses a file's elements with dcmjs (dictionary names, VR, module group, PHI flag, decoded words, nested sequences), `dicomTags_summarize` tells constant from varying across a folder, and `dicomSeries_summarize` answers what a folder is as a series from its listing plus one header read (identity, modality, instance count, stack order from oxidicom's file names, geometry, transfer syntax, bytes, annotations by SeriesInstanceUID). Headers read once are cached by path.
