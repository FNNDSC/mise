---
"@fnndsc/porter": patch
---

A login onto an older daemon restarts it the way the RESTART pill does. The old daemon is told why and waited out before the new one boots, so a terminal attaches to the new session rather than a port that is closing; and the door now reads the versions a berth carries, so a session restarted once is current and is not restarted again.
