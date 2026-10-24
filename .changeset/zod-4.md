---
"@fnndsc/menu": minor
"@fnndsc/calypso": patch
"@fnndsc/porter": patch
"@fnndsc/salsa": patch
---

Zod moves to 4.6.7: zod 3 carries a high-severity advisory with no 3.x fix, which failed every build's audit. The advisory is GHSA-mrhx-c7xc-m3w5, memory exhaustion while validating oversized constrained collections. The wire schemas read as before: `.catch` fallbacks, `.default` values, `.passthrough()` and the recursive DICOM tag parse were checked against zod 4. `dicomTagSchema` is typed `z.ZodType<DicomTag, unknown>`; schemas exported from `@fnndsc/menu` are zod 4 schemas, so code that names zod 3's types against them (`ZodTypeDef`, `SafeParseReturnType`) has to move too. A boundary reason now renders a symbol in a path instead of throwing. salsa's nested lockfile, which only the audit reads, overrides zod until a `@fnndsc/menu` built on zod 4 is published, and is back in step with salsa's `package.json`.
