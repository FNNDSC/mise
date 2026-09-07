---
"@fnndsc/brasa": minor
"@fnndsc/argus": minor
---

feat: a write is checked before it happens, and says what it did

A chooser can hand a write a place that cannot be used, so `--csv-to` stopped trusting the path it is given:

- **A provider path is refused by name.** `/net/pacs/x.csv` is somewhere to browse, not somewhere a file lands, and CUBE's own refusal talks about an upload, which says nothing about why.
- **A missing folder is made, and said** — a directory appearing without a word is the silent side effect this replaces. argus's EXPORT CSV no longer runs `mkdir ~/audits` behind the operator's back; it lowers to `--csv-to` with no value, so the destination is asked for.
- **An existing table is never overwritten in silence.** It takes `--force`, and the replacement is reported.
- **The pane states the path** the kernel reported writing, rather than leaving it to the console alone.

Three things the live run turned up that no mock would have shown:

* **`files_listAll` answers null for an empty folder AND for one that is not there**, so existence can never be inferred from it. Doing so reported a folder "made" that already existed, and a file "already there" in a folder that did not exist at all. Existence is asked of `files_path_isDirectory` now.
* **CUBE answers a re-upload over a path it already holds with a 500, thrown.** An unhandled throw in a builtin does not stop at the command: under a daemon it takes the process, and every surface attached to it. The write is wrapped — a store's bad day is a refusal, not an outage.
* **Deletion is asynchronous**, so removing a file and writing in the same breath races the store and answers 500 again — with the operator's old file already gone. `--force` now removes, waits for the path to stop resolving, writes, and confirms by listing afterwards, because a write reported without confirmation was seen to leave nothing behind.

Both CUBE behaviours are recorded in `docs/CUBE-gaps.adoc`, with what the API could offer instead.
