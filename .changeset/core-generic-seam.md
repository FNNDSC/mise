---
"@fnndsc/menu": minor
"@fnndsc/brasa": patch
---

Nothing changes at the prompt: the engine reads its generic pieces from their own homes, not from cumin (#1001). menu gains the envelope helpers `envelope_ok`, `envelope_error` and `envelope_isOk`, beside the `CommandEnvelope` they make; cumin keeps its own for its callers. brasa reads `Result` and the error stack from fond and the envelope from menu. The error stack is still the one instance cumin shares. The core command group imports its builtins module by module rather than through the builtins barrel. `lint:core-deps` drops from 14 to 9.
