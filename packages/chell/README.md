# Chell - The ChRIS Interactive Shell

`chell` (ChRIS Execution Logic Layer) is an interactive command-line interface (CLI) designed to provide a shell-like experience for interacting with a ChRIS instance. It abstracts complex ChRIS API interactions behind familiar Unix-like commands, leveraging the core functionalities provided by `cumin` (utilities), `salsa` (business logic), and `chili` (CLI helpers).

## Features

`chell` is continuously evolving, but already offers a robust set of features to make ChRIS interaction intuitive and efficient:

*   **Interactive REPL:** A Read-Eval-Print Loop for continuous interaction.
*   **Enhanced Startup Splash:** A "techy" boot sequence displaying version, system diagnostics (OS, User, Time), and initialization status.
*   **ChRIS Connection Management:**
    *   Connect/logout from ChRIS CUBE instances.
    *   Initial connection via CLI arguments (`chell user@url -p password`).
    *   Secure password input with hidden characters.
*   **Virtual File System (VFS):** Navigate ChRIS resources as if they were a local filesystem.
    *   **`/bin` Directory:** A virtual directory listing all available ChRIS plugins, including their versions.
    *   **Standard Navigation:** `cd`, `ls`, `pwd` commands behave like their Unix counterparts.
    *   **Path Resolution:** Supports `~` (home directory) expansion (e.g., `cd ~/uploads`).
*   **Advanced `ls` Functionality:**
    *   `ls -l`: Provides a "long listing" format, displaying type (d/f/l), owner, size, creation date (with time), and name.
    *   `ls -lh`: Displays sizes in human-readable formats (e.g., KB, MB, GB).
    *   **Link Resolution:** For links (`l` type), the `ls -l` command shows the target path (e.g., `linkname -> /path/to/target`).
    *   Directories and links are color-coded for clarity (bright blue for directories, bright cyan for links).
*   **`cat` Command:** Display the contents of text files stored on the ChRIS filesystem directly in the shell.
*   **Command History:** Persists command history across sessions, allowing you to recall previous commands using arrow keys.
*   **Tab Completion:**
    *   Auto-completes built-in commands.
    *   Context-aware path completion for commands like `cd`, `ls`, `cat`, `mkdir`, `touch` (including virtual `/bin` paths).

## Architecture & Design Principles

`chell` is built as the top layer of a modular TypeScript stack:

*   **`cumin` (Core Utilities):** Provides foundational functionalities like session management, context handling, and generic resource operations. It now centrally manages generic pagination logic (`resources_getAll`) for all ChRIS collection resources.
*   **`salsa` (Business Logic):** Offers higher-level, reusable APIs for interacting with specific ChRIS resource types (plugins, files, feeds). It leverages `cumin`'s generic pagination to fetch complete resource lists.
*   **`chili` (CLI Helpers):** Provides command-line parsing, display utilities, and specific command implementations which `chell` can either reuse or dispatch to. `chili` also benefits from `salsa`'s improved resource fetching capabilities.

This layered approach ensures maintainability, reusability, and a clear separation of concerns.

## Installation & Setup

1.  **Prerequisites:**
    *   [Node.js](https://nodejs.org/) (LTS recommended)
    *   [npm](https://www.npmjs.com/) (usually comes with Node.js)
    *   [NVM (Node Version Manager)](https://github.com/nvm-sh/nvm) is highly recommended for managing Node.js installations, especially for global package linking without `sudo`.

2.  **Clone `chell`:**
    Begin by cloning only the `chell` repository into your desired projects directory:
    ```bash
    cd /path/to/your/projects/
    git clone https://github.com/FNNDSC/chell.git
    ```

3.  **Build the Entire Ecosystem (Recommended):**
    Navigate into the cloned `chell` directory. The provided `Makefile` is designed to set up the entire `chell` ecosystem, including its dependencies (`cumin`, `salsa`, `chili`), with a single command:
    ```bash
    cd chell
    make meal
    ```
    This powerful command orchestrates the following:
    *   `scrub`: Cleans up any previous build artifacts and `node_modules` directories across `chell` and its dependencies.
    *   `shop`: **Conditionally clones** `cumin`, `salsa`, and `chili` if they are not present in sibling directories. If they already exist, it performs a `git pull` to ensure they are up-to-date.
    *   `prep`: Installs `npm` dependencies for `chell` and all its newly cloned/updated dependencies.
    *   `cook`: Builds (compiles TypeScript) `chell` and all its dependencies in the correct order.
    *   (Optionally, depending on your `meal` target definition, it might also include `taste` for running tests and `serve` for global `npm link`).

    This makes `make meal` a convenient, all-in-one command for setting up your `chell` development environment from scratch.

### Other Useful Makefile Targets

*   **`make shop`**: Checks for and clones/updates `cumin`, `salsa`, and `chili`.
*   **`make prep`**: Installs `npm` dependencies for `chell` and its dependencies.
*   **`make cook`**: Builds (compiles) `chell` and its dependencies.
*   **`make taste`**: Runs tests for `chell`.
*   **`make serve`**: Globally links `chell` (via `npm link`) so you can run it from any directory.
*   **`make scrub`**: Cleans build artifacts and `node_modules`.

### Connecting to ChRIS

You can connect upon startup:
```bash
chell <user>@<chris-url> --password <your-password>
# Example: chell chris@localhost:8000/api/v1/ --password chris1234
```
Alternatively, use the `connect` command within the shell:
```bash
> connect --user chris --password chris1234 http://localhost:8000/api/v1/
```
(Password input will be hidden)

### Basic Commands

*   **`ls`**: List contents of the current directory.
    *   `ls -l`: Long listing (type, owner, size, date, name).
    *   `ls -lh`: Long listing with human-readable sizes.
    *   `ls /bin`: List all available ChRIS plugins.
*   **`cd <path>`**: Change directory. Supports absolute paths, relative paths, and `~` expansion.
*   **`pwd`**: Print the current working directory.
*   **`cat <file>`**: Display the content of a file.
*   **`logout`**: Disconnect from the current ChRIS instance.
*   **`help`**: Display available commands (or `man` within `chili` if you're in that context).
*   **`exit` / `quit`**: Exit the shell.

### Tab Completion

Press `<TAB>` for auto-completion:
*   **Commands:** `c<TAB>` might suggest `cd`, `cat`, `connect`.
*   **Paths:** After `cd `, `ls `, `cat `, etc., press `<TAB>` to complete file and directory names (including in `/bin`).

## Current Version

`chell` version: `1.0.18`

## Contributing & Development

`chell` adheres to strict TypeScript style guidelines, including Reverse Polish Notation (RPN) naming conventions. If contributing, please familiarize yourself with the project's `TYPESCRIPT-STYLE-GUIDE.md` located in the root of the `chell` directory.

---
`chell` is part of the ChRIS Project developed by FNNDSC.