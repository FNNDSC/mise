---
"@fnndsc/brasa": minor
---

The core shell runs with no ChRIS package at all: `@fnndsc/brasa/core` boots over the null backend (#1001). `nullBackend_make` gives a session with no commands of its own, a filesystem held in memory, and a home at `/home/<user>`. The `@fnndsc/brasa/core` entry installs no backend; a host passes `engine_create` the one it runs over. CI proves it on every change (`npm run test:core-boot`): plain Node boots the core over the null backend with cumin, salsa and chili refused. It then runs navigation, the file tools, pipes, redirection and help, and fails if anything asked for a ChRIS package, caught or not.
