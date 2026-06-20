# Piping in ChELL

ChELL now supports Unix-style piping to chain chell commands with local system tools.

## Overview

The piping feature allows you to:
- Execute a chell command and pipe its output to local tools
- Chain multiple pipes for complex data processing
- Handle both text and binary data

## Syntax

```bash
chell_command | local_tool [args] | another_tool [args]
```

## How It Works

1. **Parse**: ChELL parses the command line and splits it on pipe operators (`|`)
2. **Execute**: The first segment is executed as a chell builtin command
3. **Capture**: Output from the chell command is captured in a buffer
4. **Pipe**: The captured output is piped through each subsequent local tool
5. **Output**: Final result is displayed to the user

## Examples

### Simple Pipe
```bash
# Pipe a file to jq for JSON formatting
cat data.json | jq

# Pipe to grep to filter results
ls -l | grep .txt
```

### Compound Piping
```bash
# Chain multiple pipes
cat file.json | jq '.data' | wc -l

# Complex filtering
files | grep complete | sort
```

### Binary Data
```bash
# Pipe binary files (e.g., images)
cat image.jpg | imagemagick convert - output.png
```

## Implementation Details

### Pipe Parsing
The `pipes_parse()` function intelligently splits commands on pipe operators while respecting quoted strings:

- Handles single quotes (`'`)
- Handles double quotes (`"`)
- Pipe characters inside quotes are NOT treated as operators

Example:
```bash
cat "file | with | pipes.txt" | grep test
# ^ This pipe inside quotes is preserved
#                                ^ This pipe is the operator
```

### Output Capture
The `output_capture()` function temporarily redirects `console.log` and `console.error` to capture all output from builtin commands into a buffer. This ensures:

- All command output is captured
- Both stdout and stderr are collected
- Original console methods are restored after execution

### Pipe Execution
The `pipe_execute()` function:

1. Executes the first command using `chellCommand_executeAndCapture()`
2. Spawns each subsequent command as a child process
3. Pipes data from one process to the next
4. Uses Node.js `spawn` with proper stdio configuration
5. Handles errors gracefully with descriptive messages

### Binary Data Support
The implementation uses Node.js `Buffer` throughout the pipe chain to support both text and binary data:

- Output is captured as `Buffer`
- Data is piped through processes as binary streams
- Final output is written to stdout preserving binary integrity

## Limitations

1. **ChELL commands only in first position**: Only the first segment can be a chell builtin command. Subsequent segments must be local system tools.

   ```bash
   # ✓ Correct
   cat file.txt | grep test

   # ✗ Incorrect
   echo test | cat /some/chell/path
   ```

2. **Help flags**: The `--help` flag in piped commands is not processed separately. It will be passed as an argument to the command.

3. **Interactive commands**: Commands requiring user input in the middle of a pipe chain may not work as expected.

## Error Handling

If any command in the pipe chain fails:
- An error message is displayed showing which command failed
- The pipe chain execution stops
- No partial output is displayed

Example error:
```bash
cat file.json | invalid_command
# Output: Pipe error: Command 'invalid_command' exited with code 127
```

## Technical Architecture

### Code Location
- **File**: `src/chell.ts`
- **Functions**:
  - `pipes_parse(line: string): string[]` - Parses command line for pipes
  - `output_capture(fn: () => Promise<void>): Promise<{text: string; buffer: Buffer}>` - Captures console output
  - `chellCommand_executeAndCapture(commandLine: string): Promise<{text: string; buffer: Buffer}>` - Executes chell command with output capture
  - `pipe_execute(segments: string[]): Promise<void>` - Executes pipe chain
  - `command_handle(line: string): Promise<void>` - Modified to detect and handle pipes

### Integration
The piping feature is integrated into the main command handling flow:
1. `command_handle()` receives user input
2. Checks for pipe operators using `pipes_parse()`
3. If pipes detected, delegates to `pipe_execute()`
4. Otherwise, executes as normal builtin command

## Testing

Basic tests are included in `tests/pipes.test.ts`. To manually test:

```bash
# Start chell
npm start

# In chell, try:
pwd | cat
ls | wc -l
context | grep URL
```

## Future Enhancements

Potential improvements:
- Support for output redirection (`>`, `>>`)
- Input redirection (`<`)
- Background processes (`&`)
- Process substitution (`<()`, `>()`)
- Pipe to multiple chell commands in sequence
