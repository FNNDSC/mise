---
"@fnndsc/brasa": patch
---

Nothing changes at the prompt: the session asks its backend for its home and working directory (#982). `core/backend.ts` holds the backend descriptor (`Backend`, `backend_install`, `backend_get`); `chris/backend.ts` is the ChRIS one, keeping the working directory in the identity's context as before and the CUBE connection reachable as `session.connection`. `engine_create` takes an optional backend; the package entry installs ChRIS, so every host boots as it did. The saved-session and token connect functions move to `chris/connect.ts` and are exported as before. `lint:core-deps` also counts core files that import the ChRIS backend's `chris/` folder and drops to 16.
