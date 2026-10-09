---
"@fnndsc/brasa": patch
"@fnndsc/calypso": patch
---

Nothing changes at the prompt: what it shows and what the daemon heartbeats come from the backend (#982). The descriptor gains `prompt` and `telemetry`, both in the wire's existing shapes (`PromptContext`, and `BackendTelemetry` with jobs, feeds, CUBE pace and job state). The ChRIS backend supplies its session prompt context and /proc snapshot; those files (`promptContext.ts`, `jobsState.ts`) move to `chris/` and are exported as before. calypso's launch takes both from the backend and imports neither. A backend without them gets no promptline or heartbeat providers. `lint:core-deps` drops to 14.
