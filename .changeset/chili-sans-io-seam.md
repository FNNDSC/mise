---
"@fnndsc/chili": minor
---

chili's command layer no longer prints straight to the console. A new output seam (`screen/output.ts`) routes all command output through a swappable `ChiliWriter` — `chiliLog`/`chiliErrLog`/`chiliWrite` — whose default delegates to the process console, so the standalone CLI is unchanged. A host captures a run's output with `chili_capture(fn)`, and `run_capture(argv)` runs a single command with its output collected as strings, so an in-process host (the brasa engine) can drive chili headless without a console monkeypatch.
