---
"@fnndsc/brasa": minor
---

brasa: `record` — a session writes itself down as a manifest.

The workflows worth sharing are the fiddly ones nobody will retype correctly. `record start <manifest>` … `record stop` captures the lines the session runs and writes them as a manifest someone else can play. It costs almost nothing because the lowering was already the law: a press on a surface and a line at a console arrive at the same place, so both are captured alike.

A recording is a TRANSCRIPT and stays one. It never invents expectations — a file that guessed at assertions would be a fiction, and adding `expect` lines is the author's act, the one that turns a recording into a test. It does not film its own camera (`record` and `play` lines are not captured), and it does not capture the lines a played manifest runs, which are already written down in the file being played.

What makes a recording personal is its identifiers, so the ones a PACS line wears on its face — `PatientID`, `AccessionNumber`, `PatientName` — are offered as parameters, written as defaults so the file still plays exactly as recorded. The same value gets one name wherever it appears and a second distinct value gets a name of its own, so a workflow over two patients does not collapse into one. A value stops at an underscore or a slash: a query's projection folder is `PatientID:1279049_qid:3125_owner`, and a looser match would have parameterized the query id along with the MRN.

Fifth slice of the manifest work (`docs/manifest.adoc`).
