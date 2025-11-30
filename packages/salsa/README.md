```
 ____        _
/ ___|  __ _| |___  __ _
\___ \ / _` | / __|/ _` |
 ___) | (_| | \__ \ (_| |
|____/ \__,_|_|___/\__,_|
```

**Salsa Abstracts Logic Service Assets**

`salsa` is the logic layer of the ChRIS interface ecosystem. It is a TypeScript library that encapsulates high-level business intents and operational logic, serving as the bridge between user-facing interfaces (like the `chili` CLI) and the underlying infrastructure (`cumin` and `chrisapi`).

## Purpose

- **Consolidate Business Logic:** Centralizes "Intents" (e.g., "Create a Feed from these local files", "Run a Plugin with these parameters"). This ensures that `chili` (CLI), future web apps, and other frontends share the exact same behavior.
- **Frontend Agnostic:** Designed to be free of CLI-specific dependencies (like `commander` or `process.stdout`). It returns pure data or typed objects.
- **Powering Chefs:** Provides the primitive file operations that power the `chefs` shell experience in `chili` and `chell`.

## Architecture: The Sandwich Model 🥪

```text
[ Chili (CLI) ]   [ Web App ]   [ Mobile App ]
       |               |              |
       +-------+-------+              |
               |                      |
               v                      v
    [      Salsa (Logic / Intents)        ]  <-- YOU ARE HERE
               |
               v
    [      Cumin (State / Infrastructure) ]
               |
               v
    [      @fnndsc/chrisapi (Client)      ]
```

## Key Modules

-   **`feeds`**: Logic for creating and managing feeds.
-   **`plugins`**: Logic for searching, resolving, running, and registering plugins. `plugins_listAll` fetches complete lists.
-   **`files`**: File system interactions:
    -   `files_listAll`: Fetch complete directory listings (pagination handling).
    -   `files_content`: Read remote file content.
    -   `files_uploadPath`: Recursively upload local files or directories to ChRIS.
    -   `files_touch`, `files_mkdir`.

## Development

### Build

```bash
npm run build
```

### Test

```bash
npm run test
```
