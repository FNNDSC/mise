---
"@fnndsc/brasa": patch
---

Nothing changes at the prompt: ChRIS's `${name}` references and PAT, STD and SER indexes move to its backend (#982). They are `${feed}`, `${run}`, `${query}` and `${gather}`. The core answers `${cwd}` and numbers files and folders (`@FIL`, `@DIR`). The descriptor gains `references`, `answerKinds` and `verbTakes`, and ChRIS supplies its four references, its three kinds and what its verbs take (`chris/references.ts`). A verb handed the wrong kind still refuses by name, in the same words. The syntax hint still reads `@SER3, @STD1, @FIL2, @DIR4`. `AnswerKind` is an open string.
