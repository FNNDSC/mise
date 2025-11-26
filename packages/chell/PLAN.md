# PLAN.md for `chell` MVP

## Project: `chell` - ChRIS Interactive REPL Shell

**Goal:** Provide an interactive command-line experience for ChRIS users, integrating with `chili`, `salsa`, and `cumin` to abstract complex API interactions behind a familiar shell interface.

**MVP Features (Implemented):**

1.  **Basic REPL Functionality:**
    *   [x] Read user input.
    *   [x] Process commands.
    *   [x] Display output.
    *   [x] Maintain persistent session state (connection, context).

2.  **Customizable Prompt:**
    *   [x] Default format: `[user]@URI:[pwd]$>`
    *   [x] Dynamically update `user`, `URI`, and `pwd` based on the current ChRIS connection and context.

3.  **CUBE Connection Management:**
    *   [x] Ability to `connect` to a ChRIS CUBE instance (direct implementation).
    *   [x] Ability to `logout` from a ChRIS CUBE instance (direct implementation).
    *   [x] Leverage `chrisConnection` singleton from `@fnndsc/cumin`.

4.  **"chili chefs" Command Proxy:**
    *   [x] `ls`: Supports relative/absolute paths and `/bin` VFS.
    *   [x] `cd`: Validates path against CUBE.
    *   [x] `pwd`: Shows current context.
    *   [x] `mkdir`, `touch`: Delegated to `chili` logic.

5.  **Virtual File System (VFS) for `/bin`:**
    *   [x] Intercept `ls /bin`.
    *   [x] Query ChRIS for available plugins.
    *   [x] Display plugin names.

**Non-MVP (Future Enhancements):**

*   **`cd` to Plugin Instance:** Implement navigation into a plugin instance's virtual directory.
*   **Contextual Plugin Execution:** Automagically wire `previous_id` for plugins run from a plugin instance directory.
*   **Full VFS (feeds, files, etc.):** Expand the VFS beyond `/bin` to represent feeds, files, and other ChRIS resources as navigable directories.
*   **Error Handling & User Feedback:** More robust, user-friendly error messages.
*   **Command History & Autocompletion:** Enhance REPL usability.
*   **Alias Management:** Allow users to define custom aliases for commands.