# ChELL: ChELL Executes Layered Logic

**The Interactive Shell for ChRIS**

ChELL is a sophisticated command-line interface that transforms the ChRIS distributed computing platform into a familiar, local filesystem experience. It bridges the gap between complex web APIs and the intuitive, muscle-memory efficiency of Unix-like shells.

If you are comfortable with `bash`, `zsh`, or even the macOS Terminal, you already know how to use ChELL.

## The Concept

ChRIS is a powerful platform for medical analytics, but interacting with it often involves navigating complex web UIs or verbose REST APIs. ChELL abstracts this complexity behind the universal metaphor of a filesystem.

*   **Feeds and Folders:** Navigate remote ChRIS data directories as if they were on your local drive.
*   **Plugins as Executables:** Discover and manage analysis tools in a virtual `/bin` directory, treating remote algorithms like local binaries.
*   **The Store as a Package Manager:** Search and install new capabilities using a workflow analogous to `apt`, `brew`, or `yay`.

## Key Features

### 1. A True Shell Experience
ChELL provides a persistent Read-Eval-Print Loop (REPL) with all the creature comforts of a modern terminal:
*   **Tab Autocompletion:** Instantly complete paths, commands, and plugin names.
*   **Command History:** Cycle through your previous operations.
*   **Shell Escapes:** Execute local system commands without leaving ChELL using the `!` prefix.
*   **Rich Output:** Color-coded listings distinguish between directories, files, links, and plugins at a glance.

### 2. Seamless Filesystem Navigation
Use standard commands to explore the ChRIS environment. The learning curve is non-existent.
*   **Navigation:** `cd`, `pwd`
*   **Inspection:** `ls` (with `-l`, `-h` support), `tree`, `du`
*   **File Ops:** `cat`, `cp`, `mv`, `rm`, `mkdir`, `touch`
*   **Transfer:** `upload` (with robust progress bars and recursion)

### 3. The Virtual /bin
ChELL mounts a special virtual directory at `/bin`. This directory populates dynamically with every plugin available in your ChRIS environment. It allows you to "browse" your available tools just as you would browse `/usr/bin` on Linux.

```bash
cd /bin
ls -l
# Output:
# prwxr-xr-x  chris  2024-12-05  0  pl-dircopy-v2.1.1
# prwxr-xr-x  chris  2024-12-05  0  pl-fshack-v1.2.0
```

### 4. The Store: Your Package Manager
ChELL treats the public ChRIS store as an upstream repository. The `store` and `plugin` commands function as your package manager, allowing you to discover and install new algorithms directly from the shell.

*   **Search:** `store search <query>` (like `apt search`)
*   **List:** `store list` (browse the catalog)
*   **Install:** `plugin add <name>` (like `apt install`)

This integration supports:
*   **Peer Store Search:** Automatically finds plugins in the public ecosystem.
*   **Docker Integration:** Can pull and register plugins directly from Docker Hub.
*   **Smart Resolution:** Handles versioning and dependency checking automatically.

### 5. Scripting and Automation
ChELL is not just for interactive use. The `-c` (or `--command`) flag allows you to pipe commands into ChELL or use it in shell scripts, making it a powerful component in larger automation pipelines.

```bash
# Pipe a listing to a local file
chell -c "ls -l /home/user/study" > study_contents.txt

# Automate plugin registration
chell -c "plugin add fnndsc/pl-dircopy:latest --adminUser admin --adminPassword secret"
```

## Getting Started

### Installation

ChELL is part of the ChRIS TUI ecosystem. It is typically built and installed via the project's Makefile:

```bash
make taco
```

### Connecting

Start the shell and connect to your ChRIS CUBE instance:

```bash
chell
> connect --user chris --password chris1234 http://localhost:8000/api/v1/
```

Or connect instantly from the command line:

```bash
chell -u chris -p chris1234 http://localhost:8000/api/v1/
```

### A Typical Workflow

```bash
# 1. Explore the environment
ls -lh
cd /home/chris/uploads

# 2. Upload local data
upload ~/local_mri_data/ .

# 3. Check available tools
cd /bin
ls pl-mri*

# 4. Find a new tool in the store
store search simplefs

# 5. Install the tool
# Best practice: Use the full Docker image name to ensure robustness
plugin add fnndsc/pl-simplefsapp:latest

# 6. Run the analysis
cd ~/uploads
plugin run pl-simplefsapp --inputdir . --outputdir ../results
```

## Architecture

ChELL acts as the presentation layer in the "Sandwich Model" architecture:

1.  **ChELL:** The interactive shell and user experience layer.
2.  **ChILI:** The Command Line Interface library (controllers and views).
3.  **Salsa:** The business logic and intent layer.
4.  **Cumin:** The infrastructure, state, and connection layer.

---
*ChELL is part of the ChRIS Project.*