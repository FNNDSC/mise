# ChELL - The ChRIS Interactive Shell

`chell` (ChELL Execution Logic Layer) is an interactive command-line interface (CLI) designed to provide a shell-like experience for interacting with a ChRIS instance. It acts as a sophisticated consumer of the `chili` library, providing a persistent REPL environment for the core ChRIS operations.

## Features

`chell` offers a robust set of features to make ChRIS interaction intuitive and efficient:

*   **Interactive REPL:** A Read-Eval-Print Loop for continuous interaction.
*   **Enhanced Startup Splash:** A "techy" boot sequence displaying version, system diagnostics (OS, User, Time), and initialization status.
*   **ChRIS Connection Management:**
    *   Connect/logout from ChRIS CUBE instances.
    *   Initial connection via CLI arguments (`chell user@url -p password`).
    *   Secure password input with hidden characters.
*   **Virtual File System (VFS):** Navigate ChRIS resources as if they were a local filesystem.
    *   **`/bin` Directory:** A virtual directory listing all available ChRIS plugins.
    *   **Standard Navigation:** `cd`, `ls`, `pwd` commands behave like their Unix counterparts.
    *   **Path Resolution:** Supports `~` (home directory) expansion.
*   **Advanced `ls` Functionality:**
    *   `ls -l`: Provides a "long listing" format, displaying type, owner, size, creation date, and name.
    *   `ls -lh`: Displays sizes in human-readable formats.
    *   **Color Coding:** Directories (blue), links (cyan), and plugins (green) are distinct.
*   **`cat` Command:** Display the contents of text files stored on the ChRIS filesystem.
*   **`upload` Command:** Recursively upload local files and directories to ChRIS.
*   **Plugin & Feed Management:**
    *   `plugin list` / `plugin run`
    *   `feed list` / `feed create`
*   **Command History:** Persists command history across sessions.
*   **Tab Completion:** Auto-completes built-in commands and paths.

## Architecture & Design Principles

`chell` is the interactive top layer of the "Sandwich Model" architecture:

1.  **`chell` (Shell):** The interactive REPL. It parses user input and invokes commands directly from the `chili` library. It does **not** spawn external processes for core commands, ensuring a fast, integrated experience.
2.  **`chili` (Library & CLI):** The single source of truth for command logic (Controllers) and output formatting (Views). It provides strongly-typed APIs for `chell` to consume.
3.  **`salsa` (Business Logic):** The pure business logic layer, defining resource models and operations.
4.  **`cumin` (Infrastructure):** Handles state, connection, and raw IO.

## Installation & Setup

1.  **Prerequisites:**
    *   [Node.js](https://nodejs.org/) (LTS recommended)
    *   [npm](https://www.npmjs.com/) (usually comes with Node.js)
    *   [NVM (Node Version Manager)](https://github.com/nvm-sh/nvm) is recommended.

2.  **Clone `chell`:**
    ```bash
    git clone https://github.com/FNNDSC/chell.git
    cd chell
    ```

3.  **Build the Ecosystem:**
    The `Makefile` sets up the entire stack (`cumin`, `salsa`, `chili`, `chell`):
    ```bash
    make taco
    ```
    This command clones dependencies, installs packages, and builds everything in the correct order.

### Connecting to ChRIS

You can connect upon startup:
```bash
chell <user>@<chris-url> --password <your-password>
```
Alternatively, use the `connect` command within the shell:
```bash
> connect --user chris --password chris1234 http://localhost:8000/api/v1/
```

### Basic Commands

*   **`ls`**: List contents. Supports `-l` (long) and `-h` (human-readable).
*   **`cd <path>`**: Change directory.
*   **`pwd`**: Print working directory.
*   **`cat <file>`**: Display file content.
*   **`upload <local> <remote>`**: Upload files/folders to ChRIS.
*   **`plugin list`**: List available plugins.
*   **`plugin run <name> <params>`**: Run a plugin.
*   **`feed list`**: List feeds.
*   **`feed create --dirs <paths>`**: Create a new feed.
*   **`logout`**: Disconnect.
*   **`exit`**: Exit the shell.

## Current Version

`chell` version: `1.0.20`

---
`chell` is part of the ChRIS Project developed by FNNDSC.