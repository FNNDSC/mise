---
"@fnndsc/brasa": minor
---

Long jobs now outlive the command that starts them, and kill and wait reach them. A backend hands its jobs to the core's runner (`core/runner.ts`); each kind is mounted under `/proc/<source>` as a task source, its record and whole log kept under `$XDG_STATE_HOME/<backend>/jobs`. A job that was running when the session ended is picked up again through its source's `resume`, or marked failed saying why. Starting a job needs the `tasks` tier. `kill <task>` asks a job to stop and never forces it (a second `kill` says so); `wait [<task>]` follows a job's log to its end and takes its status, and Ctrl-C stops following, not the job. A job's end is announced to every surface.
