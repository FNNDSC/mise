# ADR 0001: Rename `fieldslist` subcommand to `inspect`

**Date:** 2026-06-02
**Status:** Accepted

## Context

All chell resource commands followed the `<object> <verb>` grammar (RPN style, consistent with `TYPESCRIPT-STYLE-GUIDE.md`). The subcommand for listing available fields on a resource was named `fieldslist` — a compound noun, not a verb, and therefore a grammar violation:

```
plugins fieldslist    ✗  noun compound, not a verb
plugins inspect       ✓  verb, follows <object> <verb>
```

`fieldslist` was present on `plugins` and `feeds` before the 3.0/4.0 resource architecture refactor.

## Decision

Rename `fieldslist` → `inspect` across all resource commands as part of the 3.0/4.0 refactor.

`inspect` was chosen over alternatives:
- `schema` — not a verb in this project's grammar
- `fields` — a noun, same problem as `fieldslist`
- `describe` — reserved for richer per-instance detail (full metadata, all field values for a specific item)
- `columns` — too display-specific, implies tabular output only

## Consequences

**Breaking change** — any scripts or muscle memory using `plugins fieldslist` or `feeds fieldslist` will break. Acceptable because:

1. The 3.0/4.0 refactor is already a major version bump — breaking changes are expected
2. The old name was a grammar violation that would have been confusing to document consistently
3. `inspect` is a natural verb that reads correctly for every resource: `groups inspect`, `workflows inspect`, `compute inspect`

**Note:** `describe` is explicitly NOT used here and is reserved for future per-instance rich detail (`plugins describe <id>`), consistent with the distinction between resource-level introspection (`inspect`) and instance-level introspection (`describe`).
