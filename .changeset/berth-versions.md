---
"@fnndsc/calypso": patch
---

The daemon's berth now records which package versions it runs and when it booted. A porter reads that to tell a session from before its last upgrade; older berths without the field count as older.
