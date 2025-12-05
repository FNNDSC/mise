# Plugin Execution in chell - Implementation Guide

**Status:** ✅ Implemented
**Date:** 2025-12-05
**Version:** 1.0
**Purpose:** Technical reference for "run plugin by typing name" feature in chell

---

## Overview

This feature allows users to run ChRIS plugins by simply typing the plugin name in chell, with the filesystem context (current directory) implicitly providing the data context.

## User Experience

```bash
# Scenario 1: New Analysis (non-feed directory)
cd ~/uploads/SAG-anon
pl-dcm2niix-v1.0.2 --outputdir results -- feed_title="Brain MRI Analysis"

# Output:
# Using feed title: "SAG-anon" (customize with -- feed_title="Custom Title")
# Feed created: 2326
# Job scheduled: pl-dcm2niix (ID: 176661)
# Output will be in: /home/rudolphpienaar/feeds/feed_2326/pl-dircopy_176660/pl-dcm2niix_176661/data/

# Scenario 2: Continuing Analysis (in feed)
cd ~/feeds/feed_2326/pl-dircopy_176660/pl-dcm2niix_176661/data/
pl-segmentation-v1.0.0 --threshold 0.5

# Output:
# Job scheduled: pl-segmentation (ID: 176780)
# Output will be in: /home/rudolphpienaar/feeds/feed_2326/pl-dircopy_176660/pl-dcm2niix_176661/pl-segmentation_176780/data/
```

## DAG Filesystem Structure

The filesystem tree mirrors the computational DAG:

```
feeds/feed_2326/
  └── pl-dircopy_176660/              ← Initial data copy
      ├── data/                        ← Copied input data
      └── pl-dcm2niix_176661/          ← First plugin (child of dircopy)
          ├── data/                    ← Plugin output
          └── pl-segmentation_176780/  ← Second plugin (child of dcm2niix)
              └── data/                ← Plugin output
```

Each plugin instance directory contains:
- `data/` - The plugin's output
- Child plugin directories - Plugins that used this as input

## Architecture

### Layer Separation

```
┌─────────────────────────────────────────────┐
│  chell (Presentation)                       │
│  - builtins/pluginExecute.ts                │
│  - Command interception & rendering         │
│  - Plugin name format conversion            │
└─────────────────────────────────────────────┘
                    ↓
┌─────────────────────────────────────────────┐
│  salsa (Business Logic)                     │
│  - plugins/plugin_executeInPlace.ts         │
│  - High-level execution intent              │
│  - DAG path construction                    │
└─────────────────────────────────────────────┘
                    ↓
┌─────────────────────────────────────────────┐
│  cumin (Infrastructure)                     │
│  - path/chrisPath.ts (NEW)                  │
│  - plugins/chrisPlugins.ts (MODIFIED)       │
│  - Path analysis & API calls                │
└─────────────────────────────────────────────┘
```

**Critical Principle:** Core logic resides in cumin/salsa for reusability across frontends.

## Key Implementation Details

### 1. Plugin Name Format Conversion

chell's `/bin` displays: `pl-dcm2niix-v1.0.2`
ChRIS search expects: `name_exact:pl-dcm2niix,version:1.0.2`

**Conversion function** (`chell/src/builtins/pluginExecute.ts`):
```typescript
function pluginName_toSearchString(pluginName: string): string {
  const match = pluginName.match(/^(.+)-v(.+)$/);
  if (match) {
    return `name_exact:${match[1]},version:${match[2]}`;
  }
  return `name_exact:${pluginName}`;
}
```

### 2. Parameter Format: CLI-Style

cumin's `dictionary_fromCLI()` expects: `--key1 value1 --key2 value2`
NOT JSON: `{"key1": "value1"}`

**Conversion function** (`salsa/src/plugins/index.ts`):
```typescript
function dictionary_toCLI(params: Dictionary): string {
  const parts: string[] = [];
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null) {
      parts.push(`--${key} ${value}`);
    }
  }
  return parts.join(' ');
}
```

### 3. DAG Path Construction

**New Feed:**
```
/home/${user}/feeds/feed_${feedID}/pl-dircopy_${dircopyID}/${pluginName}_${instanceID}/data/
```

**Continue Analysis:**
Walk current path to find directory ending with `_${previousID}`, then append:
```
${previousPluginPath}/${pluginName}_${instanceID}/data/
```

**Implementation** (`salsa/src/plugins/plugin_executeInPlace.ts`):
```typescript
// Find previous plugin instance directory
const pathParts = cwd.split('/');
let previousPluginPath = '';

for (let i = 0; i < pathParts.length; i++) {
  if (pathParts[i].endsWith(`_${previousID}`)) {
    previousPluginPath = pathParts.slice(0, i + 1).join('/');
    break;
  }
}

const outputPath = `${previousPluginPath}/${actualPluginName}_${pluginInstanceID}/data/`;
```

### 4. Tab Completion Optimizations

**Pre-caching** (`chell/src/chell.ts`):
```typescript
// Pre-cache /bin for fast tab completion
if (!session.offline) {
  spinner.start('Populating plugin cache');
  await vfs.data_get('/bin');
  spinner.stop();
}
```

**Cache-first completion** (`chell/src/lib/completer/index.ts`):
1. Builtins complete instantly (no network)
2. Plugin names from cache (instant after startup)
3. Only fetch from API on cache miss

### 5. No Interactive Prompts

Original plan included prompts, but implementation uses automatic defaults:
- Feed title defaults to directory name
- User can override via `-- feed_title="Custom"`
- Simpler, faster, no REPL conflict issues

## Implementation Components

### cumin: Path Analysis Module

**File:** `cumin/src/path/chrisPath.ts` (NEW)

```typescript
export function path_isInFeed(dirPath: string): boolean;
export function path_extractPluginInstanceID(dirPath: string): number | null;
export function path_extractFeedID(dirPath: string): number | null;
export function path_findLatestDircopy(binListing: string[]): string | null;
```

**All variables explicitly typed per TYPESCRIPT-STYLE-GUIDE.**

### cumin: Modified plugin_run()

**File:** `cumin/src/plugins/chrisPlugins.ts` (MODIFIED)

**Change:** Prioritize explicit `previous_id` from params over context.

```typescript
const pluginParams: ChRISObjectParams = dictionary_fromCLI(params);

let previousID: number;
if (pluginParams.previous_id !== undefined) {
  previousID = Number(pluginParams.previous_id);
} else {
  const contextPreviousID: number | null = await this.previousID_get();
  if (contextPreviousID === null) return null;
  previousID = contextPreviousID;
}
```

### salsa: Execute In Place Intent

**File:** `salsa/src/plugins/plugin_executeInPlace.ts` (NEW)

```typescript
export interface PluginExecutionResult {
  feedID?: number;
  dircopyInstanceID?: number;
  pluginInstanceID: number;
  pluginName: string;        // Actual plugin name (not search string)
  outputPath: string;        // Full DAG path
}

export async function plugin_executeInPlace(
  pluginName: string,         // Can be search string or name
  pluginParams: Dictionary,
  contextParams: Dictionary,
  cwd: string,
  binListing: string[]
): Promise<PluginExecutionResult | null>;
```

Handles two execution paths:
1. **New feed**: Create via pl-dircopy, run plugin with dircopy as previous_id
2. **Existing feed**: Extract previous_id from path, run plugin

### chell: Plugin Execute Builtin

**File:** `chell/src/builtins/pluginExecute.ts` (NEW)

```typescript
export async function builtin_executePlugin(
  pluginName: string,
  args: string[]
): Promise<void>;
```

**Responsibilities:**
1. Parse arguments (split on `--`)
2. Convert plugin name format for ChRIS search
3. Set default feed title if not provided
4. Delegate to salsa
5. Render output

### chell: Command Dispatcher

**File:** `chell/src/chell.ts` (MODIFIED)

```typescript
default:
  // Check if command is a plugin name in /bin
  const binResult = await vfs.data_get('/bin');
  if (binResult.ok) {
    const pluginNames = binResult.value.map(item => item.name);
    if (pluginNames.includes(command)) {
      await builtin_executePlugin(command, args);
      break;
    }
  }
  // Fall through to chili delegation
```

## Parameter Syntax

```
<plugin-name> <plugin-params> -- <context-params>
```

**Examples:**
```bash
# Just plugin params (uses directory name as feed title)
pl-dcm2niix-v1.0.2 --outputdir results

# Plugin + context params
pl-dcm2niix-v1.0.2 --outputdir results -- feed_title="Brain MRI"

# Context param only
pl-dcm2niix-v1.0.2 -- feed_title="My Analysis"
```

**Context Parameters:**
- `feed_title` - Feed name when creating new feed
- `instance_title` - Instance name for DAG visualization

## Error Handling

### Missing pl-dircopy
- Error: "pl-dircopy not found. Cannot create feeds."
- Behavior: Selects highest version if multiple exist

### Plugin Not Found
- Error shows full stack:
  ```
  Plugin execution failed:
    - [plugin_executeInPlace] | Failed to run plugin
    - [ChRISPlugin.pluginIDs_resolve] | No matching plugins found
    - [ChRISPlugin.pluginIDs_getFromSearchable] | A plugin conforming to "..." was not found
  ```

### Path Analysis Failures
- Error: "Could not extract plugin instance ID from current directory path"
- Error: "Could not extract feed ID from current directory path"

## Performance

- **Tab completion**: Instant for builtins, fast for plugins (cached)
- **Startup**: ~1-2s pre-cache of /bin
- **Plugin execution**: Immediate return (async job scheduling)

## Testing Performed

✅ New feed creation from upload directory
✅ Continue analysis from feed directory
✅ DAG path construction (multiple levels)
✅ Plugin name format conversion
✅ Parameter parsing with `--` delimiter
✅ Error reporting with full stack
✅ Tab completion performance

## Known Limitations

1. No real-time status updates during execution
2. No automatic navigation to output directory
3. No plugin output streaming
4. No `plugin status <id>` command (Phase 2)

## Version History

**v1.0** (2025-12-05)
- Initial implementation
- cumin 0.13.0, salsa 0.11.0, chell 1.23.0
- Plugin name format conversion
- DAG filesystem structure
- Tab completion optimizations
- Full type compliance with TYPESCRIPT-STYLE-GUIDE

## References

- User documentation: `chell/docs/pluginrun.adoc`
- Architecture: `chell/docs/architecture.adoc`
- VFS implementation: `chell/docs/vfs.adoc`
- Feed creation: `chili/docs/13_run_a_plugin.adoc`
