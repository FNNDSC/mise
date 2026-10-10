---
"@fnndsc/calypso": minor
"@fnndsc/brasa": patch
---

Internal: the calypso command can host the null backend for a test, with no ChRIS package loaded (#985). `CALYPSO_TEST_BACKENDS=1 calypso --backend null` hosts a session with no commands of its own and a filesystem in memory; without the variable the switch is refused. calypso's daemon code imports brasa's core entry, which now carries the version report and the logo. The calypso command loads brasa's ChRIS root only when it hosts ChRIS. A surface attached to the null daemon is told `backend: 'null'`.
