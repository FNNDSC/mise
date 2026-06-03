/**
 * @file Command help system.
 *
 * Provides help text for shell commands.
 *
 * @module
 */
import chalk from 'chalk';

interface CommandHelp {
  usage: string;
  description: string;
  options?: string[];
  examples?: string[];
}

/**
 * Standard subcommands and options injected into every resource help entry.
 * Captures the Resource Contract documented in CONTEXT.md.
 */
export const RESOURCE_LIST_OPTIONS: string[] = [
  '',
  'STANDARD SUBCOMMANDS:',
  '  list              List resources (default: 20 per page)',
  '  search <term>     Search resources (alias: list --search <term>)',
  '  inspect           List available field names',
  '',
  'STANDARD OPTIONS:',
  '  --all             Fetch all pages',
  '  --limit <n>       Page size (default: 20)',
  '  --fields <f,f>    Columns to display',
  '  --sort <field>    Sort by field',
  '  --reverse         Reverse sort order',
  '  --table           Tabular output',
  '  --csv             CSV output',
];

export const helpText: Record<string, CommandHelp> = {
  ls: {
    usage: 'ls [options] [path]',
    description: 'List directory contents',
    options: [
      '-l          Long format (detailed information, shows feed/plugin titles)',
      '-1          One entry per line (single-column)',
      '-h          Human-readable sizes (use with -l)',
      '-f, --refresh  Force refresh (ignore cache)',
      '-r, --reverse  Reverse sort order',
      '-d          List directory itself, not contents',
      '--sort=<field>  Sort by: name, size, date, owner',
    ],
    examples: [
      'ls                    # List current directory',
      'ls -l                 # Long format with titles',
      'ls -lh                # Long format with human sizes',
      'ls -f                 # Force refresh from server',
      'ls /home/user/data    # List specific directory',
      'ls *.txt              # List matching files (wildcard)',
      'ls --sort=size -r     # Sort by size, reversed',
      '',
      '# Long format shows feed and plugin instance titles:',
      '# d user 0  2025-05-18  feed_875           Brain MRI Analysis',
      '# d user 0  2025-05-18  pl-dircopy_33314   pl-dircopy v2.1.2',
    ],
  },
  cd: {
    usage: 'cd [path]',
    description: 'Change current working directory',
    examples: [
      'cd /home/user/data    # Absolute path',
      'cd experiments        # Relative path',
      'cd ..                 # Parent directory',
      'cd ~                  # Home directory',
      'cd                    # Show current directory',
    ],
  },
  pwd: {
    usage: 'pwd [options]',
    description: 'Print current working directory',
    options: [
      '--title    Replace feed_XXXX and pl-<name>_XXXX with titles in path',
    ],
    examples: [
      'pwd                  # Show actual path',
      'pwd --title          # Show path with feed/plugin titles',
      '',
      '# Example output:',
      '# pwd',
      '# /home/chris/feeds/feed_2326/pl-dircopy_176660/data',
      '',
      '# pwd --title',
      '# /home/chris/feeds/Brain MRI Analysis/dircopy v2.1.1/data',
    ],
  },
  cat: {
    usage: 'cat <file> [file...]',
    description: 'Display file contents',
    examples: [
      'cat file.txt          # Display single file',
      'cat file1 file2       # Display multiple files',
      'cat *.log             # Display all .log files (wildcard)',
    ],
  },
  edit: {
    usage: 'edit <file>',
    description: 'Edit a ChRIS file in $EDITOR — fetches, opens, saves back on write',
    options: [
      'Uses $EDITOR (or $VISUAL, or vi as fallback)',
      'No-ops if file is unchanged on exit',
      'On save: deletes original and re-uploads — file path preserved, ID changes',
      'On upload failure: edited content preserved in /tmp',
    ],
    examples: [
      'edit /home/chris/uploads/config.yaml',
      'edit notes.txt',
      'EDITOR=nano edit report.json',
    ],
  },
  rm: {
    usage: 'rm [options] <path> [path...]',
    description: 'Remove files or directories',
    options: [
      '-r, -R      Remove directories recursively',
      '-f          Force removal',
      '-i          Prompt before every removal (interactive)',
      '-rf, -fr    Recursive and force combined',
      '-ri, -ir    Recursive and interactive combined',
      '--          End of options (treat remaining args as filenames)',
    ],
    examples: [
      'rm file.txt           # Remove single file',
      'rm file1 file2        # Remove multiple files',
      'rm *.json             # Remove all .json files (wildcard)',
      'rm -i *.log           # Prompt before removing each .log file',
      'rm -r directory/      # Remove directory recursively',
      'rm -rf temp_*         # Force remove all temp_* dirs',
      'rm -- --weird-name    # Remove file starting with --',
      'rm -- -dash-file      # Remove file starting with -',
    ],
  },
  cp: {
    usage: 'cp [options] <source...> <dest>',
    description: 'Copy files or directories (supports wildcards and multiple sources)',
    options: [
      '-r, --recursive    Recursive copy (for directories)',
    ],
    examples: [
      'cp file.txt copy.txt              # Copy single file',
      'cp -r dir1/ dir2/                 # Copy directory recursively',
      'cp file1 file2 file3 dest/        # Copy multiple files',
      'cp uploads/*.txt backup/          # Copy with wildcard',
      'cp "file with spaces.txt" dest/   # Use quotes for spaces',
    ],
  },
  mv: {
    usage: 'mv <source...> <dest>',
    description: 'Move or rename files or directories (supports wildcards and multiple sources)',
    examples: [
      'mv old.txt new.txt                # Rename file',
      'mv dir1/ dir2/                    # Move directory into dir2',
      'mv file.txt /home/user/archive/   # Move into existing directory',
      'mv file1 file2 file3 dest/        # Move multiple files',
      'mv uploads/* backup/              # Move with wildcard',
      'mv "file with spaces.txt" dest/   # Use quotes for spaces',
    ],
  },
  touch: {
    usage: 'touch [options] <file>',
    description: 'Create empty files or files with content',
    options: [
      '--withContents <string>          Create file with inline string content',
      '--withContentsFromFile <file>    Create file with content from local host file',
    ],
    examples: [
      'touch file.txt                                   # Create empty file',
      'touch --withContents "Hello!" greeting.txt       # Create file with string',
      'touch --withContentsFromFile template.json config.json  # Create from local file',
    ],
  },
  mkdir: {
    usage: 'mkdir <directory> [directory...]',
    description: 'Create directories',
    examples: [
      'mkdir newdir          # Create single directory',
      'mkdir dir1 dir2       # Create multiple directories',
      'mkdir experiments/run1  # Create nested directory',
    ],
  },
  upload: {
    usage: 'upload <local_path> <chris_path>',
    description: 'Upload files from local filesystem to ChRIS with progress tracking',
    options: [
      'Displays progress bar showing:',
      '  - File count and percentage complete',
      '  - Estimated time remaining (ETA)',
      '  - Data transfer progress',
      'Shows summary statistics after upload',
    ],
    examples: [
      'upload ~/data/file.csv /home/user/uploads/',
      'upload ./results/ ~/data/',
      'upload ~/experiment/data /home/user/projects/',
    ],
  },
  download: {
    usage: 'download <chris_path> <local_path> [-f|--force]',
    description: 'Download a ChRIS file or directory to the local filesystem with progress tracking',
    options: [
      '-f, --force   Overwrite existing local paths',
      'Progress bar shows files, ETA, bytes transferred',
    ],
    examples: [
      'download /home/user/data ./data',
      'download /feeds/feed_123 ./downloads -f',
    ],
  },
  connect: {
    usage: 'connect <username> <url> [password]',
    description: 'Connect to ChRIS server',
    examples: [
      'connect alice https://cube.chrisproject.org/api/v1/',
      'connect bob http://localhost:8000/api/v1/ mypassword',
    ],
  },
  logout: {
    usage: 'logout',
    description: 'Disconnect from ChRIS server',
    examples: ['logout'],
  },
  plugin: {
    usage: 'plugin <subcommand> [options]',
    description: 'Work with a single ChRIS plugin - run, search, view documentation',
    options: [
      '',
      'DESCRIPTION:',
      '  Plugins are computational units in ChRIS that process data. The "plugin"',
      '  command operates on individual plugins - running them, searching for specific',
      '  plugins, or viewing their documentation.',
      '',
      'SUBCOMMANDS:',
      '  run <searchable> [params]    Execute a plugin instance with parameters',
      '  search <searchable>          Resolve a searchable to plugin IDs',
      '  readme <pluginId>            Display plugin README documentation',
      '',
      'SEARCHABLE FORMATS:',
      '  Simple:     pl-dircopy',
      '  Compound:   name:pl-dircopy,version:1.3.2',
      '  ID-based:   id:42',
      '  Batch:      id:77++id:33  (multiple plugins)',
      '',
      'PLUGIN RUN PARAMETERS:',
      '  Plugin-specific parameters use CLI flag format:',
      '    --param value              Single parameter',
      '    --flag                     Boolean flag',
      '    --param1 val1 --param2 val2   Multiple parameters',
      '',
      '  Run "parametersofplugin <name>" to see available parameters for a plugin.',
    ],
    examples: [
      '# Search for plugins',
      'plugin search pl-dircopy',
      'plugin search name:dcm2niix',
      'plugin search id:42',
      '',
      '# View plugin documentation',
      'plugin readme 42',
      'plugin readme pl-dircopy',
      '',
      '# Run a plugin (simple)',
      'plugin run pl-dircopy',
      '',
      '# Run plugin with parameters',
      'plugin run pl-dircopy --dir /incoming',
      'plugin run name:pl-dcm2niix,version:1.0.2 --outputdir /results',
      '',
      '# Run with multiple parameters',
      'plugin run pl-segmentation --threshold 0.5 --method watershed',
      '',
      '# Run with specific version',
      'plugin run name:pl-dircopy,version:2.1.1 --dir /data',
    ],
  },
  plugins: {
    usage: 'plugins <subcommand> [options]',
    description: 'Manage collections of ChRIS plugins - list, add, delete, query',
    options: [
      '',
      'DESCRIPTION:',
      '  Plugins are computational units in ChRIS. The "plugins" command operates on',
      '  collections of plugins - listing all available plugins, adding new plugins to',
      '  ChRIS, deleting plugins, or querying plugin metadata.',
      ...RESOURCE_LIST_OPTIONS,
      '',
      'RESOURCE-SPECIFIC SUBCOMMANDS:',
      '  add <input>       [admin] Register a new plugin to ChRIS',
      '  delete <id>       [admin] Remove a plugin from ChRIS',
      '  overview          Show plugin system overview',
      '',
      'PLUGINS ADD OPTIONS:',
      '  --compute <resources>         Comma-separated compute resources (default: host)',
      '  --store <url>                 Peer store URL (default: cube.chrisproject.org)',
      '  --adminUser <username>        Admin username (to skip interactive prompt)',
      '  --adminPassword <password>    Admin password (to skip interactive prompt)',
      '  --publicRepo <url>            Public repository URL for the plugin',
      '',
      'PLUGIN INPUT FORMATS:',
      '  Plugin name:      pl-dircopy',
      '  Docker image:     fnndsc/pl-dircopy:2.1.1',
      '  Store URL:        https://cube.chrisproject.org/api/v1/plugins/96/',
    ],
    examples: [
      '# List all plugins',
      'plugins list',
      'plugins list --all',
      'plugins list --search name:dircopy',
      'plugins list --fields name,version,dock_image',
      'plugins search dircopy',
      '',
      '# Inspect available fields',
      'plugins inspect',
      '',
      '# Delete a plugin',
      'plugins delete 42',
      '',
      '# Show plugin system overview',
      'plugins overview',
      '',
      '# Add plugin from peer store (searches cube.chrisproject.org)',
      'plugins add pl-dircopy',
      'plugins add pl-dircopy --compute host,gpu',
      '',
      '# Add plugin with admin credentials (skip prompt)',
      'plugins add pl-dircopy --adminUser chris --adminPassword chris1234',
      '',
      '# Add plugin from Docker image',
      'plugins add fnndsc/pl-dircopy:2.1.1',
      'plugins add fnndsc/pl-dircopy:2.1.1 --compute host',
      '',
      '# Add plugin from custom peer store',
      'plugins add pl-custom --store https://my-cube.org/api/v1/',
      '',
      '# Add plugin with specific repository',
      'plugins add my-plugin:latest --publicRepo https://github.com/org/my-plugin',
    ],
  },
  feed: {
    usage: 'feed <subcommand> [options]',
    description: 'Work with a single ChRIS feed - create, annotate, comment',
    options: [
      '',
      'SUBCOMMANDS:',
      '  create <path>                    Create a new feed from a data directory',
      '  note <feedId>                    Show the feed\'s note',
      '  note edit <feedId>              Open note in $EDITOR',
      '  note <feedId> --title <t>        Update note title',
      '  note <feedId> --content <c>      Update note content',
      '  comments <feedId>                List all comments on a feed',
      '  comment add <feedId>             Add a comment (--title, --content)',
      '  comment edit <feedId> <commentId>  Edit a comment (--title, --content)',
      '  comment delete <feedId> <commentId>  Delete a comment',
    ],
    examples: [
      'feed create /home/user/uploads/MRI-data',
      'feed note 42',
      'feed note 42 --title "QC passed" --content "No artefacts found"',
      'feed comments 42',
      'feed comment add 42 --title "Issue" --content "Slice 14 looks odd"',
      'feed comment edit 42 7 --content "Resolved — motion artefact, excluded"',
      'feed comment delete 42 7',
    ],
  },
  feeds: {
    usage: 'feeds <subcommand> [options]',
    description: 'Manage collections of ChRIS feeds - list, delete, share, query',
    options: [
      '',
      'DESCRIPTION:',
      '  A feed represents a data analysis workflow in ChRIS - a DAG of linked plugin',
      '  instances, also navigable as a folder at /home/<user>/feeds/.',
      ...RESOURCE_LIST_OPTIONS,
      '--user <username>   Filter by owner username (admin only)',
      '',
      'RESOURCE-SPECIFIC SUBCOMMANDS:',
      '  delete <id>       Remove a feed',
      '  share <id>        Share a feed with other users',
    ],
    examples: [
      'feeds list',
      'feeds list --all',
      'feeds list --limit 100',
      'feeds search experiment',
      'feeds list --fields id,name,creation_date',
      'feeds list --user radstar',
      'feeds list --all --user radstar',
      'feeds inspect',
      'feeds delete 123',
      'feeds share 123',
    ],
  },
  files: {
    usage: 'files <subcommand> [path] [options]',
    description: 'Manage ChRIS file resources',
    options: [...RESOURCE_LIST_OPTIONS],
    examples: [
      'files list',
      'files list /path',
      'files search fname:dicom',
      'files inspect',
    ],
  },
  links: {
    usage: 'links <subcommand> [path] [options]',
    description: 'Manage ChRIS link resources',
    options: [...RESOURCE_LIST_OPTIONS],
    examples: ['links list', 'links search', 'links inspect'],
  },
  dirs: {
    usage: 'dirs <subcommand> [path] [options]',
    description: 'Manage ChRIS directory resources',
    options: [...RESOURCE_LIST_OPTIONS],
    examples: ['dirs list', 'dirs search', 'dirs inspect'],
  },
  pipeline: {
    usage: 'pipeline <subcommand> [args]',
    description: 'Manage and execute ChRIS pipelines (registered DAG workflows)',
    options: [
      ...RESOURCE_LIST_OPTIONS,
      '',
      'RESOURCE-SPECIFIC SUBCOMMANDS:',
      '  info <name|id>        Show pipeline nodes, plugins, and topology',
      '  run <name|id>         Execute pipeline on current context node',
      '  source <name|id>      Display the pipeline YAML source file',
      '  delete <id>           Remove a pipeline',
      '',
      'RUN OPTIONS:',
      '  --compute <resource>  Override compute resource for all nodes',
      '  --previous <inst_id>  Explicit previous instance ID (default: context node)',
      '',
      'PIPELINE EXECUTABLES:',
      '  Pipelines also appear in /bin (colored magenta) and can be invoked directly.',
      '  <PipelineName>              Run pipeline on context node',
      '  <PipelineName> --nodes      Show DAG structure (alias: --parameters)',
      '  <PipelineName> --source     Show YAML source (alias: --readme)',
      '  cat /bin/<PipelineName>     Same as pipeline source',
    ],
    examples: [
      'pipeline list                          # List all pipelines',
      'pipeline list PHI                      # Filter by name',
      'pipeline info PHI_detection            # Show nodes and topology',
      'pipeline run PHI_detection             # Run on current context node',
      'pipeline run PHI_detection --compute gpu',
      'pipeline source PHI_detection          # Show YAML source',
      '',
      '# Direct invocation from /bin',
      'PHI_detection                          # Run with defaults',
      'PHI_detection --nodes                  # Show node structure',
      'PHI_detection --source                 # Show YAML source',
      'cat /bin/PHI_detection                 # Same as --source',
    ],
  },
  pacs: {
    usage: 'pacs <subcommand> [args]',
    description: 'PACS subsystem — server context, query, and series retrieval',
    options: [
      'SUBCOMMANDS:',
      '  connect               List registered PACS servers with active one marked',
      '  connect <name|id>     Set active PACS server',
      '  disconnect            Clear active PACS server',
      '  list                  List registered PACS servers (alias: pacs connect)',
      '  query <Key:Value...>  Create PACS query and wait for results',
      '  pull <vfs-path...>    Pull DICOM series into ChRIS storage',
    ],
    examples: [
      'pacs                              # Show active server',
      'pacs connect                      # List all servers',
      'pacs connect PACSDCM              # Set active server by identifier',
      'pacs connect 1                    # Set active server by numeric ID',
      'pacs disconnect                   # Clear active server',
      'pacs list                         # List all servers',
      'pacs query PatientID:1234         # Query PACS',
      'pacs pull /net/pacs/queries/42_AccessionNumber:22548684',
    ],
  },
  'pacs query': {
    usage: 'pacs query <Key:Value[,Key:Value...]> [--title <title>] [--pacsserver <id>]',
    description: 'Create a PACS query, wait for results, and print the VFS path',
    options: [
      '--title <title>      Title for the query record (default: Query <timestamp>)',
      '--pacsserver <id>    Override PACS server (default: context PACSserver)',
      '--table              Render results as a table instead of the default list',
      '--help               Show this help',
    ],
    examples: [
      'pacs query PatientID:1234',
      'pacs query AccessionNumber:22548684 --title "Hip DDH workup"',
      'pacs query PatientID:1234,StudyDate:20240101',
      '',
      '# Standalone alias (identical behaviour)',
      'query PatientID:1234',
    ],
  },
  'pacs pull': {
    usage: 'pacs pull [--nowait] [--retry N] <vfs-path|query-expr> [...]',
    description: 'Pull PACS series into ChRIS storage (blocking, with LONK progress)',
    options: [
      '--nowait      Fire retrieves and exit immediately; prints <seriesUID> <retrieveId> per line',
      '--retry N     Re-fire retrieves for [NO LONK] series up to N additional times',
      '--help        Show this help',
    ],
    examples: [
      'pacs pull /net/pacs/queries/42_AccessionNumber:22548684',
      'pacs pull /net/pacs/queries/42_.../Study_1.2.3_US-Hips_DDH',
      'pacs pull AccessionNumber:22548684   # query-then-pull shorthand',
      '',
      '# Standalone alias (identical behaviour)',
      'pull /net/pacs/queries/42_AccessionNumber:22548684',
    ],
  },
  'pacs connect': {
    usage: 'pacs connect [<name|id>]',
    description: 'List registered PACS servers or set the active one',
    examples: [
      'pacs connect                  # List all servers with active marked',
      'pacs connect PACSDCM          # Set active server by identifier',
      'pacs connect 1                # Set active server by numeric ID',
    ],
  },
  'pacs disconnect': {
    usage: 'pacs disconnect',
    description: 'Clear the active PACS server from context',
    examples: [
      'pacs disconnect               # Clear active server',
    ],
  },
  'pacs list': {
    usage: 'pacs list',
    description: 'List registered PACS servers with active one marked (alias: pacs connect)',
    examples: [
      'pacs list                     # List all servers',
    ],
  },
  pacsservers: {
    usage: 'pacsservers <subcommand> [options]',
    description: 'List or inspect available PACS servers (context-aware)',
    examples: [
      'pacsservers list         # List PACS servers',
      'pacsservers list --table # Table view',
      'pacsservers fieldslist   # Show fields',
    ],
  },
  pacsqueries: {
    usage: 'pacsqueries <subcommand> [options]',
    description: 'Create or list PACS queries (uses current pacsserver context unless overridden)',
    options: [
      '--pacsserver <id|name>  Use specific PACS server for this call',
      '--title <string>        Title for created query',
      '--search <filters>      Filters for list (supports comma-separated key:value)',
    ],
    examples: [
      'pacsqueries list                          # List for current pacsserver',
      'pacsqueries list --pacsserver PACSDCM     # Override server',
      'pacsqueries create "PatientID:1234" --title "PID 1234"',
      'pacsqueries decode <id>                   # Decode a query result',
    ],
  },
  pacsretrieve: {
    usage: 'pacsretrieve <subcommand> [options]',
    description: 'Pull or inspect DICOM retrieves for PACS queries',
    examples: [
      'pacsretrieve pull <queryId>       # Pull data for a query',
      'pacsretrieve report <queryId>     # Show retrieve status',
      'pacsretrieve cancel <retrieveId> # Cancel a retrieve',
    ],
  },
  exit: {
    usage: 'exit',
    description: 'Exit the shell',
    examples: ['exit'],
  },
  context: {
    usage: 'context',
    description: 'Display current ChRIS context information',
    examples: ['context'],
  },
  whoami: {
    usage: 'whoami',
    description: 'Print the currently authenticated ChRIS username',
    examples: ['whoami'],
  },
  whereami: {
    usage: 'whereami',
    description: 'Print the current CUBE URL',
    examples: ['whereami'],
  },
  proc: {
    usage: 'proc refresh [feed_id]',
    description: 'Rebuild the /proc/feeds job cache. Scoped to a single feed if feed_id given.',
    examples: ['proc refresh', 'proc refresh 123', 'proc refresh feed_123'],
  },
  prompt: {
    usage: 'prompt [list | <theme>]',
    description: 'List available prompt themes or switch the active theme',
    options: [
      'list        Show all available themes (marks the active one)',
      '<theme>     Switch to the named theme immediately',
    ],
    examples: [
      'prompt             # Show current theme',
      'prompt list        # List all themes',
      'prompt default     # Switch to single-line smart-truncation theme',
      'prompt p10k        # Switch to two-line Powerlevel10k-inspired theme',
    ],
  },
  physicalmode: {
    usage: 'physicalmode [on|off]',
    description: 'Toggle or display physical filesystem mode',
    options: [
      'on          Enable physical mode (paths used directly)',
      'off         Disable physical mode (use logical-to-physical mapping)',
    ],
    examples: [
      'physicalmode          # Show current status',
      'physicalmode on       # Enable physical mode',
      'physicalmode off      # Disable physical mode',
    ],
  },
  timing: {
    usage: 'timing [on|off]',
    description: 'Toggle or display command timing mode',
    options: [
      'on          Enable timing display',
      'off         Disable timing display',
    ],
    examples: [
      'timing                # Show current status',
      'timing on             # Enable timing display',
      'timing off            # Disable timing display',
    ],
  },
  debug: {
    usage: 'debug [on|off]',
    description: 'Toggle or display debug mode (verbose logging)',
    options: [
      'on          Enable debug logging',
      'off         Disable debug logging',
    ],
    examples: [
      'debug                 # Show current status',
      'debug on              # Enable debug mode',
      'debug off             # Disable debug mode',
    ],
  },
  parametersofplugin: {
    usage: 'parametersofplugin <plugin_name>',
    description: 'Display parameters for a specific plugin',
    examples: [
      'parametersofplugin pl-dircopy',
      'parametersofplugin pl-simpledsapp',
    ],
  },
  tree: {
    usage: 'tree [options] [path]',
    description: 'Display directory tree structure',
    options: [
      '--follow    Follow symbolic links when traversing',
    ],
    examples: [
      'tree                  # Tree of current directory',
      'tree /home/user/data  # Tree of specific path',
      'tree --follow         # Follow symbolic links',
    ],
  },
  du: {
    usage: 'du [options] [path]',
    description: 'Display disk usage statistics (mimics Linux du)',
    options: [
      '-h, --human-readable  Print sizes in human readable format',
      '-s, --summarize       Display only total for each argument',
      '-a, --all             Show counts for all files, not just directories',
      '-c, --total           Produce a grand total',
      '-d N, --max-depth=N   Print total only if N or fewer levels below',
      '-S, --separate-dirs   Do not include size of subdirectories',
    ],
    examples: [
      'du                    # Disk usage of current directory',
      'du -h                 # Human-readable sizes (1K, 234M, 2G)',
      'du -s /home/user/data # Summary only for specified path',
      'du -a                 # Show all files, not just directories',
      'du -c                 # Show grand total at end',
      'du -d 2               # Max depth of 2 levels',
      'du -sh                # Human-readable summary',
    ],
  },
  store: {
    usage: 'store <subcommand> [options]',
    description: 'Browse, search, and install plugins from ChRIS peer store',
    options: [
      '',
      'NOTE: The Store is an external peer ChRIS instance, not a local CUBE resource.',
      '      Standard resource options (--all, --limit, etc.) do not apply.',
      '',
      'SUBCOMMANDS:',
      '  list              Browse all plugins in the peer store',
      '  search <query>    Search plugins by name',
      '  install <name>    Install a plugin from the store into local CUBE',
      '  inspect           Show current peer store URL and connection info',
      '  set <url>         Set peer store URL (persisted to ~/.config/chell/settings.json)',
      '  reset             Reset peer store URL to default (cube.chrisproject.org)',
      '',
      'INSTALL OPTIONS:',
      '  --compute <names>     Compute resources (comma-separated)',
      '  --adminUser <user>    Admin username for install',
      '  --adminPassword <pw>  Admin password for install',
      '-l                      Long listing format',
    ],
    examples: [
      'store list',
      'store search dicom',
      'store install pl-dcm2niix',
      'store install pl-dcm2niix-v1.2.3',
      'store install fnndsc/pl-dcm2niix:1.2.3',
      'store install pl-dcm2niix --compute moc',
      'store inspect',
      'store set https://my-cube.org/api/v1/',
      'store reset',
    ],
  },
  compute: {
    usage: 'compute <subcommand> [options]',
    description: 'Manage ChRIS compute resources',
    options: [
      ...RESOURCE_LIST_OPTIONS,
    ],
    examples: [
      'compute list',
      'compute list --table',
      'compute list --csv',
      'compute inspect',
    ],
  },
  tag: {
    usage: 'tags <subcommand> [options]',
    description: 'Manage ChRIS tags',
    options: [
      ...RESOURCE_LIST_OPTIONS,
      '',
      'RESOURCE-SPECIFIC SUBCOMMANDS:',
      '  create <name>     Create a new tag',
      '  update <id> <name>  Rename a tag',
      '  delete <id>       Remove a tag',
    ],
    examples: ['tags list', 'tags search brain', 'tags inspect', 'tag create neuro', 'tag delete 5'],
  },
  tags: {
    usage: 'tags <subcommand> [options]',
    description: 'Manage ChRIS tags',
    options: [
      ...RESOURCE_LIST_OPTIONS,
      '',
      'RESOURCE-SPECIFIC SUBCOMMANDS:',
      '  create <name>     Create a new tag',
      '  update <id> <name>  Rename a tag',
      '  delete <id>       Remove a tag',
    ],
    examples: ['tags list', 'tags search brain', 'tags inspect', 'tag create neuro', 'tag delete 5'],
  },
  group: {
    usage: 'groups <subcommand> [options]',
    description: 'Manage ChRIS user groups',
    options: [
      ...RESOURCE_LIST_OPTIONS,
      '',
      'RESOURCE-SPECIFIC SUBCOMMANDS:',
      '  members <id>          List users in a group',
      '  create <name>         [admin] Create a new group',
      '  delete <id>           [admin] Remove a group',
      '  adduser <id> <user>   [admin] Add user to group',
      '  removeuser <id> <user> [admin] Remove user from group',
    ],
    examples: ['groups list', 'groups search all_users', 'groups inspect', 'group members 3'],
  },
  groups: {
    usage: 'groups <subcommand> [options]',
    description: 'Manage ChRIS user groups',
    options: [
      ...RESOURCE_LIST_OPTIONS,
      '',
      'RESOURCE-SPECIFIC SUBCOMMANDS:',
      '  members <id>          List users in a group',
      '  create <name>         [admin] Create a new group',
      '  delete <id>           [admin] Remove a group',
      '  adduser <id> <user>   [admin] Add user to group',
      '  removeuser <id> <user> [admin] Remove user from group',
    ],
    examples: ['groups list', 'groups search all_users', 'groups inspect', 'group members 3'],
  },
  pluginmeta: {
    usage: 'pluginmetas <subcommand> [options]',
    description: 'Browse ChRIS plugin metadata (abstract tool identities across versions)',
    options: [
      ...RESOURCE_LIST_OPTIONS,
      '',
      'RESOURCE-SPECIFIC SUBCOMMANDS:',
      '  plugins <id>      List all registered versions of a plugin meta',
    ],
    examples: ['pluginmetas list', 'pluginmetas search dircopy', 'pluginmetas inspect', 'pluginmeta plugins 12'],
  },
  pluginmetas: {
    usage: 'pluginmetas <subcommand> [options]',
    description: 'Browse ChRIS plugin metadata (abstract tool identities across versions)',
    options: [
      ...RESOURCE_LIST_OPTIONS,
      '',
      'RESOURCE-SPECIFIC SUBCOMMANDS:',
      '  plugins <id>      List all registered versions of a plugin meta',
    ],
    examples: ['pluginmetas list', 'pluginmetas search dircopy', 'pluginmetas inspect', 'pluginmeta plugins 12'],
  },
  plugininstance: {
    usage: 'plugininstances <subcommand> [options]',
    description: 'Manage ChRIS plugin instances (jobs)',
    options: [
      ...RESOURCE_LIST_OPTIONS,
      '',
      'RESOURCE-SPECIFIC SUBCOMMANDS:',
      '  cancel <id>       Cancel a running job',
      '  delete <id>       Remove a job',
      '  output <id>       Show output folder path',
      '  parameters <id>   List job parameters',
    ],
    examples: ['jobs list', 'jobs list --all', 'jobs search status:started', 'jobs inspect', 'job cancel 42', 'job output 42'],
  },
  plugininstances: {
    usage: 'plugininstances <subcommand> [options]',
    description: 'Manage ChRIS plugin instances (jobs)',
    options: [
      ...RESOURCE_LIST_OPTIONS,
      '',
      'RESOURCE-SPECIFIC SUBCOMMANDS:',
      '  cancel <id>       Cancel a running job',
      '  delete <id>       Remove a job',
      '  output <id>       Show output folder path',
      '  parameters <id>   List job parameters',
    ],
    examples: ['jobs list', 'jobs list --all', 'jobs search status:started', 'jobs inspect', 'job cancel 42', 'job output 42'],
  },
  workflow: {
    usage: 'workflows <subcommand> [options]',
    description: 'Manage ChRIS workflows (pipeline executions)',
    options: [
      ...RESOURCE_LIST_OPTIONS,
      '',
      'RESOURCE-SPECIFIC SUBCOMMANDS:',
      '  run               Run a pipeline (alias: pipeline run)',
      '  jobs <id>         List plugin instances created by this workflow',
      '  rename <id> <title>  Rename a workflow',
      '  delete <id>       Remove a workflow',
    ],
    examples: ['workflows list', 'workflows list --all', 'workflows inspect', 'workflow jobs 7', 'workflow delete 7'],
  },
  workflows: {
    usage: 'workflows <subcommand> [options]',
    description: 'Manage ChRIS workflows (pipeline executions)',
    options: [
      ...RESOURCE_LIST_OPTIONS,
      '',
      'RESOURCE-SPECIFIC SUBCOMMANDS:',
      '  run               Run a pipeline (alias: pipeline run)',
      '  jobs <id>         List plugin instances created by this workflow',
      '  rename <id> <title>  Rename a workflow',
      '  delete <id>       Remove a workflow',
    ],
    examples: ['workflows list', 'workflows list --all', 'workflows inspect', 'workflow jobs 7', 'workflow delete 7'],
  },
  meta: { usage: 'pluginmetas <subcommand> [options]', description: 'Alias for pluginmeta/pluginmetas', options: [...RESOURCE_LIST_OPTIONS], examples: ['metas list', 'meta inspect'] },
  metas: { usage: 'pluginmetas <subcommand> [options]', description: 'Alias for pluginmeta/pluginmetas', options: [...RESOURCE_LIST_OPTIONS], examples: ['metas list', 'meta inspect'] },
  instance: { usage: 'plugininstances <subcommand> [options]', description: 'Alias for plugininstance/plugininstances/job/jobs', options: [...RESOURCE_LIST_OPTIONS], examples: ['instances list', 'instance cancel 42'] },
  instances: { usage: 'plugininstances <subcommand> [options]', description: 'Alias for plugininstance/plugininstances/job/jobs', options: [...RESOURCE_LIST_OPTIONS], examples: ['instances list', 'instance cancel 42'] },
  job: { usage: 'plugininstances <subcommand> [options]', description: 'Alias for plugininstance/plugininstances', options: [...RESOURCE_LIST_OPTIONS], examples: ['jobs list', 'job cancel 42', 'job output 42'] },
  jobs: { usage: 'plugininstances <subcommand> [options]', description: 'Alias for plugininstance/plugininstances', options: [...RESOURCE_LIST_OPTIONS], examples: ['jobs list', 'job cancel 42', 'job output 42'] },
  help: {
    usage: 'help [command]',
    description: 'Display help information',
    examples: [
      'help                  # List all commands',
      'help ls               # Show help for ls',
      'help timing           # Show help for timing',
    ],
  },
  '!': {
    usage: '! <shell_command>',
    description: 'Execute command on host shell (shell escape)',
    examples: [
      '! ls                  # List files on host system',
      '! pwd                 # Print host working directory',
      '! cat /etc/hostname   # Read host file',
      '! df -h               # Check host disk usage',
      '! echo "test" > /tmp/file.txt  # Write to host file',
    ],
  },
  cubepath: {
    usage: 'cubepath <vfs-path> [--pacsserver <id>]',
    description: 'Show CUBE FS path and file count for each series under a PACS VFS path. Zero files = not pulled.',
    options: [
      '--pacsserver <id>    Override PACS server (default: context PACSserver)',
      '--help               Show this help',
    ],
    examples: [
      '# All series under a query',
      'cubepath /net/pacs/queries/AccessionNumber:25162540_qid:2661',
      '',
      '# All series under a study',
      'cubepath /net/pacs/queries/AccessionNumber:25162540_qid:2661/Study_1.2.3_Brain_MRI',
      '',
      '# Single series',
      'cubepath /net/pacs/queries/AccessionNumber:25162540_qid:2661/Study_1.2.3/Series_1.2.3.4_AX_T2',
    ],
  },
  query: {
    usage: 'query <Key:Value[,Key:Value...]> [--title <title>] [--pacsserver <id>]',
    description: 'Create a PACS query, wait for results, and print the VFS path',
    options: [
      '--title <title>      Title for the query record (default: Query <timestamp>)',
      '--pacsserver <id>    Override PACS server (default: context PACSserver)',
      '--table              Render results as a table instead of the default list',
      '--help               Show this help',
    ],
    examples: [
      'query PatientID:1234',
      'query AccessionNumber:22548684 --title "Hip DDH workup"',
      'query PatientID:1234,StudyDate:20240101',
      '',
      '# Use output path directly with pull',
      'pull $(query PatientID:1234 | grep "VFS path" | awk \'{print $3}\')',
    ],
  },
  pull: {
    usage: 'pull [--nowait] <vfs-path|query-expr> [...]',
    description: 'Pull PACS series into ChRIS storage; accepts VFS paths or query expressions (blocking)',
    options: [
      '--nowait      Fire retrieves and exit immediately; prints <seriesUID> <retrieveId> per line',
      '--retry N     Re-fire retrieves for [NO LONK] series up to N additional times',
      '--help        Show this help',
    ],
    examples: [
      '# Pull all series in a query (blocking)',
      'pull /net/pacs/queries/42_AccessionNumber:22548684',
      '',
      '# Pull a single study',
      'pull /net/pacs/queries/42_AccessionNumber:22548684/Study_1.2.3_US-Hips_DDH',
      '',
      '# Pull a specific series',
      'pull /net/pacs/queries/42_AccessionNumber:22548684/Study_1.2.3_US-Hips_DDH/Series_1.2.3.4_XR',
      '',
      '# Pull multiple paths in one blocking call',
      'pull /net/pacs/queries/42_AccessionNumber:22548684 /net/pacs/queries/43_PatientID:P001',
      '',
      '# Pull directly from a query expression (creates query, waits, then pulls)',
      'pull PatientID:1234',
      'pull AccessionNumber:22548684',
      '',
      '# Fire-and-forget (scripted)',
      'pull --nowait /net/pacs/queries/42_AccessionNumber:22548684',
      '# Output: <seriesUID> <retrieveId>  (one per series, in tree-walk order)',
    ],
  },
};

/**
 * Displays help text for a command.
 *
 * @param command - The command to display help for.
 */
/**
 * Formats and returns the detailed help text for a specific command as a string.
 *
 * @param command - The command name to retrieve help for.
 * @returns The formatted help text string, or undefined if no help exists.
 */
export function commandHelp_get(command: string): string | undefined {
  const help: CommandHelp | undefined = helpText[command];

  if (!help) {
    return undefined;
  }

  const lines: string[] = [];
  lines.push('');
  lines.push(chalk.bold.magenta(command.toUpperCase()));
  lines.push(chalk.gray('─'.repeat(60)));
  lines.push('');
  
  lines.push(chalk.bold.blue('USAGE'));
  const usageParts = help.usage.split(' ');
  const cmdName = usageParts[0];
  const args = usageParts.slice(1).join(' ');
  lines.push(`  ${chalk.green(cmdName)} ${chalk.cyan(args)}`);
  
  lines.push('');
  lines.push(chalk.bold.blue('DESCRIPTION'));
  lines.push(`  ${help.description}`);

  if (help.options && help.options.length > 0) {
    lines.push('');
    lines.push(chalk.bold.blue('OPTIONS'));
    help.options.forEach((opt: string) => {
      const trimmed = opt.trim();
      if (!trimmed) {
        lines.push('');
        return;
      }
      
      // Check if it's a header (ends with :)
      if (trimmed.endsWith(':')) {
        lines.push(`  ${chalk.bold.white(trimmed)}`);
        return;
      }

      // Try to split by double space (common separator in help definitions)
      const splitMatch = opt.match(/^(\s*)(.*?)(\s{2,})(.*)$/);
      
      if (splitMatch) {
        const [, indent, content, separator, description] = splitMatch;
        lines.push(`  ${indent}${chalk.yellow(content)}${separator}${description}`);
      } else {
        // Fallback: check if it starts with -
        if (trimmed.startsWith('-')) {
          lines.push(`  ${chalk.yellow(opt)}`);
        } else {
          lines.push(`  ${opt}`);
        }
      }
    });
  }

  if (help.examples && help.examples.length > 0) {
    lines.push('');
    lines.push(chalk.bold.blue('EXAMPLES'));
    help.examples.forEach((ex: string) => {
      const commentIdx = ex.indexOf('#');
      if (commentIdx !== -1) {
        const cmdPart = ex.substring(0, commentIdx);
        const commentPart = ex.substring(commentIdx);
        lines.push(`  ${chalk.white(cmdPart)}${chalk.gray(commentPart)}`);
      } else {
        lines.push(`  ${chalk.white(ex)}`);
      }
    });
  }

  lines.push('');
  return lines.join('\n');
}

/**
 * Displays help text for a command.
 *
 * @param command - The command to display help for.
 */
export function help_show(command: string): void {
  const helpStr: string | undefined = commandHelp_get(command);

  if (helpStr !== undefined) {
    console.log(helpStr);
  } else {
    console.log(chalk.yellow(`No help available for '${command}'`));
    console.log(chalk.gray('Type "help" to see all available commands.'));
  }
}

/**
 * Checks if arguments contain --help flag.
 * -h is treated as help unless the command uses it for "human-readable" (ls, du).
 *
 * @param args - Command arguments.
 * @param command - The command name (optional).
 * @returns True if help is requested.
 */
export function args_checkHasHelpFlag(args: string[], command?: string): boolean {
  const isPluginExecutable: boolean = !!command && /-v.+$/.test(command);
  if (!isPluginExecutable && args.includes('--help')) return true;

  // Commands where -h means human-readable sizes, not help
  const humanReadableCommands = ['ls', 'du'];
  
  if (command && humanReadableCommands.includes(command)) {
    return false;
  }
  
  if (isPluginExecutable) {
    return false;
  }

  return args.includes('-h');
}

/**
 * Builtin help command - displays command list or specific command help.
 *
 * @param args - Command arguments (optional command name).
 */
export async function builtin_help(args: string[]): Promise<void> {
  const commandName: string | undefined = args.length > 0 ? args.join(' ') : undefined;

  // If a specific command is requested, show its help
  if (commandName) {
    help_show(commandName);
    return;
  }

  // Otherwise, list all available commands
  console.log('');
  console.log(chalk.bold.cyan('ChELL - Available Commands'));
  console.log(chalk.gray('─'.repeat(60)));
  console.log('');

  // Group commands by category
  const categories: Record<string, string[]> = {
    Navigation: ['cd', 'pwd', 'ls', 'tree', 'du'],
    'File Operations': ['cat', 'edit', 'cp', 'mv', 'rm', 'touch', 'mkdir', 'upload', 'download'],
    Connection: ['connect', 'logout', 'context', 'whoami', 'whereami'],
    'Single Resource': ['plugin', 'pipeline', 'feed', 'tag', 'group', 'pluginmeta', 'plugininstance', 'workflow'],
    'Resource Collections': ['plugins', 'feeds', 'files', 'links', 'dirs', 'store', 'compute', 'tags', 'groups', 'pluginmetas', 'plugininstances', 'workflows', 'parametersofplugin'],
    PACS: ['pacs', 'pacsservers', 'pacsqueries', 'pacsretrieve'],
    'Shell Settings': ['physicalmode', 'prompt', 'timing', 'debug'],
    General: ['help', 'exit', '!'],
  };

  // Display commands by category
  for (const [category, commands] of Object.entries(categories)) {
    console.log(chalk.bold.yellow(category));
    commands.forEach((cmd: string) => {
      const help: CommandHelp | undefined = helpText[cmd];
      if (help) {
        console.log(`  ${chalk.cyan(cmd.padEnd(20))} ${chalk.gray(help.description)}`);
      }
    });
    console.log('');
  }

  // Display Shell Features
  console.log(chalk.bold.yellow('Shell Features'));
  console.log(`  ${chalk.cyan('Pipes'.padEnd(20))} ${chalk.gray('Chain commands: cat file.txt | wc -l')}`);
  console.log(`  ${chalk.cyan('Redirection >'.padEnd(20))} ${chalk.gray('Write to file: cat file.txt > output.txt')}`);
  console.log(`  ${chalk.cyan('Redirection >>'.padEnd(20))} ${chalk.gray('Append to file: cat file.txt >> output.txt')}`);
  console.log('');

  console.log(chalk.gray('Type "help <command>" for detailed information about a command.'));
  console.log(chalk.gray('Type "<command> --help" for quick help on any command.'));
  console.log('');
}

/**
 * Gets the list of all builtin command names.
 *
 * @returns Array of builtin command names.
 */
export function builtinCommands_list(): string[] {
  return Object.keys(helpText);
}

/**
 * Gets the description for a builtin command.
 *
 * @param command - The command name.
 * @returns The command description, or undefined if not found.
 */
export function builtinCommand_descriptionGet(command: string): string | undefined {
  return helpText[command]?.description;
}
