---
"@fnndsc/menu": minor
"@fnndsc/brasa": minor
---

Nothing changes at the prompt: a backend can bring its long-running steps as tasks, and the core shows them under `/proc/<source>` (#983). menu's `Task` has an id, a label, a state (`queued`, `running`, `done`, `failed`, `cancelled`), progress, start and end times and a log tail. A backend's `tasks` lists its sources; one that brings no mount of its own is shown by the core as a folder per task and a file per field (label, state, progress, started, ended, log), its whole log where the source keeps one. The null backend takes task sources too, and CI's core boot lists and reads a fake one. ChRIS's `/proc/jobs` is unchanged; it becomes a source in the next step.
