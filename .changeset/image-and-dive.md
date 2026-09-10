---
"@fnndsc/argus": patch
---

The image pane says what it is doing, and a dive that opens nothing no longer strands the diver. Loading a series or building a volume now draws a progress notice on the field itself, the field is cleared before the wait rather than after it, and each layout has its own lit control instead of one pill that cycled. An OVERLAY control writes the patient, record number, accession, series, date and age on the image, off by default. In the DAG pane, a dive whose overlay declines now flies the camera back out and says why, a ghost overlay record is dropped rather than believed, and Escape leaves a node from anywhere.
