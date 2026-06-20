# Responsive Shell Plan: Making Remote Feel Local

**Document Version:** 1.1
**Date:** 2025-12-02
**Status:** Phase 1 Complete, Phase 2 In Progress
**Owner:** chell development team

---

## Implementation Status

### ✅ Completed
- **Phase 1a: Enhanced Cache** - TTL-based caching with dirty flags, LRU eviction
- **Phase 1b: Optimistic Rendering** - Stale cache serving with progress indicators
- **Cache Bug Fix** - Fixed vfs.ts to check cache before API calls
- **Timing Command** - Added timing mode for performance measurement
- **Help System** - Comprehensive help with --help flag support
- **Standalone Commands** - Added touch and mkdir as top-level builtins
- **Acronym Consistency** - Fixed ChELL and ChILI recursive acronyms

### 🚧 In Progress
- None currently

### 📋 Planned
- Phase 2: Job Management (background plugin execution)
- Phase 3: Contextual Prompt (feed context, job status)
- Phase 4: Async Prefetching

---

## Executive Summary

**Goal:** Transform chell from a latency-visible remote shell into a responsive, local-feeling interface to ChRIS, leveraging the unique computational semantics of the feed tree filesystem.

**The Problem:** Network latency (200ms per API call) breaks the shell illusion. Users experience 20+ second delays for operations that should feel instant. The current cache strategy (flush on `cd`) optimizes for correctness at the expense of performance.

**The Solution:** Four architectural pillars working together:

1. **Enhanced Cache** - Persistent, TTL-based cache with dirty flags and optimistic serving
2. **Async Job Control** - Background plugin execution with status/logs via `pluginInstance`
3. **Contextual Prompt** - Rich metadata display (feed context, job status, cache age)
4. **Optimistic Operations** - Serve cached data immediately, refresh in background

**Key Insight:** ChRIS's feed tree is not just a filesystem—it's a computational substrate. Navigation (`cd`) has semantic meaning: "make these outputs my inputs." This makes the shell metaphor *stronger* than traditional Unix shells, not weaker.

**Success Criteria:**
- `ls` in cached directory: **< 50ms** (currently 200ms)
- `cd` + immediate `ls`: **< 100ms** (currently 400ms)
- Plugin submission: **< 500ms** (returns JID immediately)
- User perception: "Feels local" in 90% of interactions

---

## Table of Contents

1. [Problem Statement](#1-problem-statement)
2. [Philosophical Foundation](#2-philosophical-foundation)
3. [Architecture Overview](#3-architecture-overview)
4. [Component 1: Enhanced Cache](#4-component-1-enhanced-cache)
5. [Component 2: Job Management](#5-component-2-job-management)
6. [Component 3: Contextual Prompt](#6-component-3-contextual-prompt)
7. [Component 4: Async Operations](#7-component-4-async-operations)
8. [Implementation Roadmap](#8-implementation-roadmap)
9. [Success Metrics](#9-success-metrics)
10. [Risk Analysis](#10-risk-analysis)
11. [Future Directions](#11-future-directions)
12. [Appendices](#12-appendices)

---

## 1. Problem Statement

### 1.1 Current State

**Latency characteristics:**
| Operation | Network Calls | Latency | User Experience |
|-----------|--------------|---------|-----------------|
| `ls /PUBLIC` (first time) | 1 | 200ms | Brief pause |
| `ls /PUBLIC` (cached) | 0 | 5ms | Instant ✓ |
| `cd /home && cd /PUBLIC` | 1 | 200ms | Pause again ✗ |
| `ls *.nii` (wildcard) | 1 | 200ms | Brief pause |
| `ls *.nii` (second time) | 0 | 5ms | Instant ✓ |
| `pl-freesurfer ...` | 1 | 5-300s | Blocks shell ✗ |

**The core problem:** Current cache strategy is too aggressive:
```typescript
// chrisContext.ts line 336-340
case Context.ChRISfolder:
  this._singleContext.folder = value;
  status = await this.ChRISfolder_set(value);
  // Invalidate listing cache on CWD change
  const listCache = listCache_get();
  listCache.cwd_update(value);  // ← FLUSHES ENTIRE CACHE
```

**Impact:**
- User navigates: `/PUBLIC` → `/home` → `/PUBLIC`
- Each return to `/PUBLIC` refetches unchanged data
- 99% of the time, `/PUBLIC` hasn't changed between visits
- Result: Unnecessary network calls, perceived sluggishness

### 1.2 Why It Matters

**User psychology:**
- Users tolerate latency when they see feedback ("Loading...")
- Users abandon systems that feel unresponsive ("Is it broken?")
- 100ms latency is perceivable but acceptable
- 1000ms latency feels slow
- 10000ms latency feels broken

**Current experience breakdown:**
- 10% of operations: Instant (cached, fresh) ✓
- 60% of operations: 100-500ms (tolerable but noticeable)
- 20% of operations: 500ms-2s (slow, frustrating)
- 10% of operations: 2-20s+ (blocking plugin runs) ✗

**Goal:** Move the distribution:
- 80% of operations: < 100ms (feels instant)
- 15% of operations: 100-500ms (acceptable with feedback)
- 5% of operations: > 500ms (spinner shown, expected for heavy ops)

### 1.3 Root Causes

**1. Cache invalidation too aggressive**
- Flushes entire cache on directory change
- Doesn't distinguish between hot paths (`/PUBLIC`) and volatile paths (`/temp`)
- No TTL or staleness concept

**2. Synchronous plugin execution**
- Blocks shell prompt during long-running jobs
- No background job management
- Forces user to wait for completion

**3. No optimistic rendering**
- Always waits for API response before showing results
- Doesn't use cache as "optimistic" data source
- No background refresh mechanism

**4. No prefetching**
- Doesn't anticipate user navigation patterns
- Doesn't preload adjacent directories
- Reactive instead of proactive

---

## 2. Philosophical Foundation

### 2.1 The Shell Metaphor: Strength, Not Weakness

**Initial concern:** Is a shell metaphor appropriate for a high-latency, remote, asynchronous system?

**Answer: Yes—because ChRIS's structure makes it MORE powerful than traditional shells.**

#### Traditional Unix Shell:
```bash
$ cd /data/scans
$ freesurfer --input scan001.nii --output results/
```
- `cd` just changes filesystem location (no semantic meaning)
- Input/output paths must be explicitly specified
- No computational provenance
- Filesystem is flat (directories are just containers)

#### ChRIS Shell:
```bash
$ cd /feeds/123/nodes/45  # Output of pl-mri_convert
$ pl-freesurfer --subject ABC
# Implicit: input = node 45's output
# Implicit: creates node 46 as child of node 45
# Implicit: feed DAG records provenance
```

**Key insight:** In ChRIS, `cd` doesn't just navigate a filesystem—it navigates a **computational substrate**. The filesystem IS the computation graph.

**This makes the shell metaphor STRONGER:**
1. **Semantic navigation** - `cd` selects inputs for next computation
2. **Implicit context** - No need to specify `--input` paths
3. **Provenance tracking** - DAG structure preserved automatically
4. **Familiar interface** - Anyone who knows bash can use ChRIS

**Conclusion:** Maintain and enhance the shell metaphor, don't abandon it.

### 2.2 The Illusion vs Reality Tradeoff

**The illusion:** chell feels like a local shell (instant response, seamless navigation)

**The reality:** chell speaks HTTP to a remote server (200ms round-trips, async jobs)

**Strategy:** Acknowledge reality when it improves UX, maintain illusion when it doesn't.

#### Maintain Illusion (Make Remote Feel Local):
- ✓ `ls`, `cd`, `pwd` should feel instant (< 100ms)
- ✓ Tab completion should be responsive (< 50ms)
- ✓ Wildcard expansion should be fast (< 100ms)
- ✓ Basic navigation should never show spinners

#### Acknowledge Reality (Show Feedback):
- ✓ Plugin submission: "Instance 4523 submitted" (< 500ms)
- ✓ Long operations: Show spinner after 500ms with context
- ✓ Background jobs: "Job 4523 completed ✓" notification
- ✓ Stale cache: "Refreshing (2m old)..." on background refresh

**Principle:** *Optimistic immediacy with honest feedback.*

### 2.3 The Async Advantage

**Problem:** ChRIS plugin execution is async (jobs run on compute cluster for minutes/hours)

**Traditional shell approach:** Block until complete
```bash
$ freesurfer ...
# Shell blocked for 2 hours
```

**ChRIS shell approach:** Background execution
```bash
$ pl-freesurfer ...
✓ Instance 4523 submitted (queued)
$ # Prompt returns immediately
$ job status 4523
RUNNING (12% complete, ETA: 18 min)
```

**This is MORE Unix-like than blocking:**
```bash
$ make -j8 &        # Background job
[1] 12345
$ jobs              # Check status
[1]+  Running  make -j8
```

**Design decision:** All plugin execution returns immediately with JID. Use `job status`/`job logs` for monitoring.

---

## 3. Architecture Overview

### 3.1 Four Pillars

```
┌─────────────────────────────────────────────────────────────┐
│                    USER EXPERIENCE LAYER                     │
│  • Instant feedback (< 100ms for 80% of operations)         │
│  • Contextual prompt (feed node, job status, cache age)     │
│  • Background operations (plugin runs, cache refresh)        │
└─────────────────────────────────────────────────────────────┘
                              ▲
                              │
        ┌─────────────────────┼─────────────────────┐
        │                     │                     │
        ▼                     ▼                     ▼
┌──────────────┐    ┌──────────────┐    ┌──────────────┐
│   PILLAR 1   │    │   PILLAR 2   │    │   PILLAR 3   │
│   Enhanced   │    │     Job      │    │  Contextual  │
│    Cache     │    │  Management  │    │    Prompt    │
├──────────────┤    ├──────────────┤    ├──────────────┤
│ • TTL-based  │    │ • Instant    │    │ • Feed node  │
│ • Dirty flag │    │   return     │    │ • Job count  │
│ • LRU evict  │    │ • Status     │    │ • Cache age  │
│ • Optimistic │    │ • Logs       │    │ • Compute    │
│   serving    │    │ • Background │    │   context    │
└──────────────┘    └──────────────┘    └──────────────┘
        │                     │                     │
        └─────────────────────┼─────────────────────┘
                              ▼
                    ┌──────────────┐
                    │   PILLAR 4   │
                    │    Async     │
                    │  Operations  │
                    ├──────────────┤
                    │ • Prefetch   │
                    │ • Background │
                    │   refresh    │
                    │ • Non-block  │
                    │   polling    │
                    └──────────────┘
```

### 3.2 Component Interaction Flow

**Example: User navigates to /PUBLIC and lists files**

```
USER: cd /PUBLIC
  ↓
[chell] builtin_cd("/PUBLIC")
  ↓
[session] setCWD("/PUBLIC")  ← Instant return (no flush!)
  ↓
[async] prefetch_directory("/PUBLIC")  ← Background (don't await)
  ↓
[prompt] returns immediately
  ↓
USER: ls
  ↓
[vfs] data_get("/PUBLIC")
  ↓
[cache] cache_get("/PUBLIC")
  │
  ├─ HIT (fresh) → return data instantly (5ms) ✓
  │
  ├─ HIT (stale) → return data + refresh in background
  │   ↓
  │   [async] files_list("/PUBLIC") fetches fresh data
  │   ↓
  │   [cache] updates with fresh data
  │   ↓
  │   [ui] shows "↻ Updated" if changed
  │
  └─ MISS → show spinner after 500ms
      ↓
      [async] files_list("/PUBLIC")
      ↓
      [cache] cache_set("/PUBLIC", data)
      ↓
      [ui] displays results
```

### 3.3 Data Flow Diagram

```
┌──────────────┐
│     User     │
│   Command    │
└──────┬───────┘
       │
       ▼
┌──────────────────────────────────────────┐
│            chell (Shell)                  │
│  • Parse command                          │
│  • Route to builtin or plugin            │
└──────┬───────────────────────────────────┘
       │
       ├─────────────┬──────────────┬──────────────┐
       ▼             ▼              ▼              ▼
┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐
│   ls     │  │   cd     │  │  plugin  │  │   job    │
│          │  │          │  │   run    │  │  status  │
└────┬─────┘  └────┬─────┘  └────┬─────┘  └────┬─────┘
     │             │              │              │
     ▼             ▼              ▼              ▼
┌─────────────────────────────────────────────────────┐
│                      vfs                             │
│  • Check cache (optimistic)                          │
│  • Fetch if needed (async)                           │
│  • Update cache                                      │
└─────────────────┬───────────────────────────────────┘
                  │
                  ▼
┌─────────────────────────────────────────────────────┐
│                   ListCache                          │
│  • TTL-based expiration                              │
│  • Dirty flag tracking                               │
│  • LRU eviction                                      │
│  • Optimistic serving                                │
└─────────────────┬───────────────────────────────────┘
                  │
                  ▼
┌─────────────────────────────────────────────────────┐
│              chili/salsa/cumin                       │
│  • API calls to ChRIS                                │
│  • Result<T> + errorStack                            │
└─────────────────────────────────────────────────────┘
```

---

## 4. Component 1: Enhanced Cache

### 4.1 Design Overview

**Current implementation:**
```typescript
class ListCache {
  cache_set(path, data)
  cache_get(path): data | null
  cwd_update(newCwd)  // ← FLUSH ALL
}
```

**Enhanced implementation:**
```typescript
interface CacheEntry {
  data: any;
  timestamp: number;
  dirty: boolean;
  ttl: number;
}

class ListCache {
  cache_get(path): { data, fresh: boolean } | null
  cache_set(path, data, options?: { ttl?, dirty? })
  cache_markDirty(path)
  cache_update(path, updater: (data) => data)
  cache_invalidate(path?)
  // NO MORE cwd_update() - no flushing!
}
```

### 4.2 Key Features

#### A. TTL-Based Expiration

**Rationale:** Different paths have different volatility. `/PUBLIC` changes rarely; `/home/user/temp` changes often.

**Implementation:**
```typescript
const TTL_CONFIG: Record<string, number> = {
  '/PUBLIC':     10 * 60 * 1000,  // 10 min (stable, large, public)
  '/home':        5 * 60 * 1000,  //  5 min (user home dirs)
  '/bin':        60 * 60 * 1000,  //  1 hour (plugins rarely change)
  '/feeds/*':     5 * 60 * 1000,  //  5 min (job outputs change)
  '/feeds/*/nodes/*/': 2 * 60 * 1000, // 2 min (active compute nodes)
  '*':            3 * 60 * 1000,  //  3 min (default)
};

function getTTL(path: string): number {
  for (const [pattern, ttl] of Object.entries(TTL_CONFIG)) {
    if (minimatch(path, pattern)) return ttl;
  }
  return TTL_CONFIG['*'];
}
```

**Fresh vs Stale:**
```typescript
cache_get(path): CacheResult | null {
  const entry = this.cache.get(path);
  if (!entry) return null;

  const age = Date.now() - entry.timestamp;
  const fresh = !entry.dirty && age < entry.ttl;

  return { data: entry.data, fresh, age };
}
```

#### B. Dirty Flag Tracking

**Rationale:** Local mutations (rm, mkdir, touch) make cache stale. Mark dirty immediately instead of invalidating.

**Usage:**
```typescript
// After rm
listCache.cache_markDirty('/home/user');

// After mkdir
listCache.cache_markDirty('/home/user');

// After upload
listCache.cache_markDirty('/feeds/123/nodes/45');
```

**Dirty entries:**
- Still serveable (optimistic rendering)
- Flagged as needing refresh
- Refreshed on next access

#### C. Optimistic Cache Updates

**Rationale:** Don't wait for API to update UI. Update cache immediately based on operation.

**Example: rm**
```typescript
async function builtin_rm(path: string): Promise<void> {
  const target = await path_resolve(path);
  const parentPath = dirname(target);

  // 1. Optimistically update cache BEFORE API call
  listCache.cache_update(parentPath, (items: ListingItem[]) => {
    return items.filter(item => item.name !== basename(target));
  });

  // 2. Show optimistic UI immediately
  console.log(chalk.gray(`removing '${path}'...`));

  // 3. Call API
  const result = await files_remove(target);

  // 4. If failed, revert cache
  if (!result.success) {
    listCache.cache_invalidate(parentPath);
    console.error(chalk.red(`rm: failed: ${result.error}`));
  } else {
    console.log(chalk.green(`removed '${path}'`));
  }
}
```

**User sees instant feedback, correction only if operation failed.**

#### D. LRU Eviction

**Rationale:** Unbounded cache = memory leak. Evict least-recently-used entries.

**Implementation:**
```typescript
private maxEntries = 100;  // ~500KB memory

cache_set(path: string, data: any, options?: CacheOptions): void {
  // LRU: delete and re-add to move to end
  if (this.cache.has(path)) {
    this.cache.delete(path);
  }

  this.cache.set(path, { data, timestamp: Date.now(), ... });

  // Evict oldest
  while (this.cache.size > this.maxEntries) {
    const oldest = this.cache.keys().next().value;
    this.cache.delete(oldest);
    this.stats.evictions++;
  }
}

cache_get(path: string): CacheResult | null {
  const entry = this.cache.get(path);
  if (!entry) return null;

  // LRU: move to end (mark as recently used)
  this.cache.delete(path);
  this.cache.set(path, entry);

  return { ... };
}
```

**Map iteration order = insertion order in JS, so this implements LRU naturally.**

### 4.3 API Specification

#### `cache_get(path: string): CacheResult | null`

**Purpose:** Retrieve cached data with freshness info.

**Returns:**
```typescript
interface CacheResult {
  data: any;        // The cached data
  fresh: boolean;   // True if within TTL and not dirty
  age: number;      // Milliseconds since cached
}
```

**Behavior:**
- Returns `null` if not in cache (cache miss)
- Marks entry as recently used (LRU)
- Updates statistics (hits, misses, staleHits)

**Example:**
```typescript
const cached = listCache.cache_get('/PUBLIC');
if (cached) {
  console.log(cached.data);  // Show immediately
  if (!cached.fresh) {
    console.log(`(${Math.floor(cached.age / 1000)}s old, refreshing...)`);
  }
}
```

#### `cache_set(path: string, data: any, options?: CacheOptions): void`

**Purpose:** Store data in cache with optional TTL override.

**Parameters:**
```typescript
interface CacheOptions {
  ttl?: number;      // Override default TTL (milliseconds)
  dirty?: boolean;   // Mark as dirty immediately
}
```

**Behavior:**
- Stores data with current timestamp
- Uses path-specific TTL unless overridden
- Evicts oldest entries if over maxEntries
- Marks as fresh (dirty = false) unless specified

**Example:**
```typescript
// Normal usage
listCache.cache_set('/PUBLIC', items);

// Override TTL for hot path
listCache.cache_set('/PUBLIC', items, { ttl: 10 * 60 * 1000 });

// Mark as dirty immediately (rare)
listCache.cache_set('/PUBLIC', items, { dirty: true });
```

#### `cache_markDirty(path: string): void`

**Purpose:** Mark cached entry as dirty (needs refresh).

**Behavior:**
- Sets `dirty = true` for entry
- Does NOT remove from cache (still serveable)
- If path not cached, no-op

**Usage:**
```typescript
// After mutation that affects this path
listCache.cache_markDirty('/home/user');
```

#### `cache_update(path: string, updater: (data: any) => any): void`

**Purpose:** Optimistically update cached data.

**Parameters:**
- `path`: The cached path to update
- `updater`: Function that transforms cached data

**Behavior:**
- Applies updater to cached data
- Resets timestamp (marks as fresh)
- Sets dirty = false (cache now matches reality)
- If path not cached, no-op

**Example:**
```typescript
// After removing file
listCache.cache_update(parentPath, (items: ListingItem[]) => {
  return items.filter(item => item.name !== 'deleted.txt');
});

// After adding file
listCache.cache_update(parentPath, (items: ListingItem[]) => {
  return [...items, newItem];
});
```

#### `cache_invalidate(path?: string): void`

**Purpose:** Remove entry from cache (or clear all).

**Parameters:**
- `path`: Optional. If provided, removes this entry. If omitted, clears entire cache.

**Behavior:**
- Deletes entry from cache
- If removing directory, also marks parent as dirty
- Statistics NOT updated (invalidation doesn't count as miss)

**Example:**
```typescript
// Invalidate specific path
listCache.cache_invalidate('/home/user/temp');

// Clear entire cache (rare, e.g., logout)
listCache.cache_invalidate();
```

### 4.4 File Location and Structure

**File:** `cumin/src/cache/listCache.ts`

**Exports:** `cumin/src/cache/index.ts`
```typescript
export { ListCache, listCache_get } from './listCache.js';
export type { CacheResult, CacheOptions, CacheStats } from './listCache.js';
```

**Imports in consumers:**
```typescript
import { listCache_get } from '@fnndsc/cumin';
```

### 4.5 Implementation Steps

1. **Update CacheEntry interface** (add timestamp, dirty, ttl)
2. **Implement getTTL() path matching**
3. **Update cache_get() to return CacheResult**
4. **Update cache_set() to accept CacheOptions**
5. **Add cache_markDirty() method**
6. **Add cache_update() method**
7. **Implement LRU eviction in cache_set()**
8. **Update cache_get() to implement LRU access**
9. **Remove cwd_update() method**
10. **Update statistics tracking**

### 4.6 Testing Criteria

#### Unit Tests

**File:** `cumin/tests/cache/listCache.test.ts`

**Test suite:**
```typescript
describe('ListCache', () => {
  describe('TTL expiration', () => {
    it('should return fresh=true within TTL', () => {
      const cache = listCache_get();
      cache.cache_set('/test', data, { ttl: 1000 });
      const result = cache.cache_get('/test');
      expect(result?.fresh).toBe(true);
    });

    it('should return fresh=false after TTL expires', async () => {
      const cache = listCache_get();
      cache.cache_set('/test', data, { ttl: 100 });
      await sleep(150);
      const result = cache.cache_get('/test');
      expect(result?.fresh).toBe(false);
      expect(result?.data).toBe(data);  // Still serveable
    });

    it('should use path-specific TTL for /PUBLIC', () => {
      const cache = listCache_get();
      cache.cache_set('/PUBLIC', data);
      // Internal: check that entry.ttl === 10 * 60 * 1000
    });
  });

  describe('Dirty flag', () => {
    it('should mark entry as dirty', () => {
      const cache = listCache_get();
      cache.cache_set('/test', data);
      cache.cache_markDirty('/test');
      const result = cache.cache_get('/test');
      expect(result?.fresh).toBe(false);
    });

    it('should not fail if marking non-existent path', () => {
      const cache = listCache_get();
      expect(() => cache.cache_markDirty('/nonexistent')).not.toThrow();
    });
  });

  describe('Optimistic updates', () => {
    it('should update cached data with updater function', () => {
      const cache = listCache_get();
      cache.cache_set('/test', [1, 2, 3]);
      cache.cache_update('/test', (arr) => arr.filter(x => x !== 2));
      const result = cache.cache_get('/test');
      expect(result?.data).toEqual([1, 3]);
      expect(result?.fresh).toBe(true);  // Reset timestamp
    });
  });

  describe('LRU eviction', () => {
    it('should evict oldest entry when maxEntries exceeded', () => {
      const cache = listCache_get();
      cache['maxEntries'] = 3;  // Override for test

      cache.cache_set('/a', 'a');
      cache.cache_set('/b', 'b');
      cache.cache_set('/c', 'c');
      cache.cache_set('/d', 'd');  // Should evict /a

      expect(cache.cache_get('/a')).toBeNull();
      expect(cache.cache_get('/d')).not.toBeNull();
    });

    it('should move accessed entries to end (LRU)', () => {
      const cache = listCache_get();
      cache['maxEntries'] = 3;

      cache.cache_set('/a', 'a');
      cache.cache_set('/b', 'b');
      cache.cache_set('/c', 'c');
      cache.cache_get('/a');  // Access /a (move to end)
      cache.cache_set('/d', 'd');  // Should evict /b, not /a

      expect(cache.cache_get('/a')).not.toBeNull();
      expect(cache.cache_get('/b')).toBeNull();
    });
  });

  describe('Statistics', () => {
    it('should track hits, misses, staleHits', () => {
      const cache = listCache_get();
      cache.stats_reset();

      cache.cache_set('/test', data, { ttl: 100 });
      cache.cache_get('/test');  // Hit (fresh)
      await sleep(150);
      cache.cache_get('/test');  // StaleHit
      cache.cache_get('/nonexistent');  // Miss

      const stats = cache.stats_get();
      expect(stats.hits).toBe(1);
      expect(stats.staleHits).toBe(1);
      expect(stats.misses).toBe(1);
    });
  });
});
```

#### Integration Tests

**File:** `chell/tests/integration/cache.test.ts`

**Test suite:**
```typescript
describe('Cache Integration', () => {
  it('should not flush cache on cd', async () => {
    const cache = listCache_get();
    cache.stats_reset();

    // Populate cache
    await builtin_cd('/PUBLIC');
    await builtin_ls([]);  // Cache miss

    // Navigate away and back
    await builtin_cd('/home');
    await builtin_cd('/PUBLIC');
    await builtin_ls([]);  // Should be cache hit

    const stats = cache.stats_get();
    expect(stats.hits + stats.staleHits).toBeGreaterThan(0);
  });

  it('should mark parent dirty after rm', async () => {
    // Setup: create file, cache parent
    await builtin_touch(['test.txt']);
    const cwd = await session.getCWD();
    await builtin_ls([]);  // Populate cache

    // Remove file
    await builtin_rm(['test.txt']);

    // Check cache
    const cached = listCache_get().cache_get(cwd);
    expect(cached?.fresh).toBe(true);  // Optimistically updated
    expect(cached?.data.some(item => item.name === 'test.txt')).toBe(false);
  });
});
```

#### Performance Tests

**File:** `chell/tests/performance/cache.test.ts`

**Test suite:**
```typescript
describe('Cache Performance', () => {
  it('should serve cached ls in < 50ms', async () => {
    await builtin_cd('/PUBLIC');
    await builtin_ls([]);  // Warm cache

    const start = Date.now();
    await builtin_ls([]);  // Should be instant
    const elapsed = Date.now() - start;

    expect(elapsed).toBeLessThan(50);
  });

  it('should handle 100 cache entries without slowdown', () => {
    const cache = listCache_get();

    // Populate 100 entries
    for (let i = 0; i < 100; i++) {
      cache.cache_set(`/path${i}`, generateMockData());
    }

    // Access should still be fast
    const start = Date.now();
    for (let i = 0; i < 100; i++) {
      cache.cache_get(`/path${i}`);
    }
    const elapsed = Date.now() - start;

    expect(elapsed).toBeLessThan(10);  // < 0.1ms per access
  });
});
```

### 4.7 Acceptance Criteria

**Functional Requirements:**

- [ ] Cache survives directory navigation (no flush on cd)
- [ ] Cache entries have TTL-based expiration
- [ ] Different paths have different TTLs (/PUBLIC vs /home/*)
- [ ] Dirty flag correctly tracks local mutations
- [ ] Optimistic updates work for rm, mkdir, touch, upload
- [ ] LRU eviction maintains cache under maxEntries
- [ ] Statistics accurately track hits, misses, staleHits, evictions

**Performance Requirements:**

- [ ] cache_get() completes in < 1ms (O(1) lookup)
- [ ] cache_set() completes in < 1ms (O(1) insertion + eviction)
- [ ] LRU access pattern: O(1) per operation
- [ ] Memory usage: < 1MB for 100 entries

**UX Requirements:**

- [ ] Stale cache is served immediately (0ms perceived latency)
- [ ] Background refresh shows "Refreshing..." indicator
- [ ] Optimistic updates show instant UI response
- [ ] Cache misses show spinner only after 500ms

**Correctness Requirements:**

- [ ] Dirty entries are never marked as fresh
- [ ] TTL expiration is accurate (within 100ms)
- [ ] LRU evicts truly oldest entry
- [ ] Optimistic updates can be reverted on API failure

---

## 5. Component 2: Job Management

### 5.1 Design Overview

**Goal:** Background plugin execution with instant return + status/logs via `pluginInstance`.

**Current behavior:**
```bash
$ pl-freesurfer --subject ABC
⠋ Running plugin... (20 minutes pass) ← Shell is BLOCKED
```

**Desired behavior:**
```bash
$ pl-freesurfer --subject ABC
✓ Instance 4523 submitted (queued)
$ # Prompt returns IMMEDIATELY
$ job status 4523
RUNNING (12% complete, ETA: 18 min)
$ job logs 4523 --follow
[streams logs in real-time]
```

**Key insight:** Jobs ARE plugin instances. Expose existing ChRIS plugin instance API via shell commands.

### 5.2 Architecture

**Layering (Sandwich Model):**

```
chell/src/builtins/job.ts
  ↓ (shell interface)
chili/src/commands/job/
  ↓ (controller + views)
salsa/src/jobs/
  ↓ (business logic)
cumin/src/jobs/chrisJob.ts
  ↓ (infrastructure)
ChRIS API
```

**Components:**

1. **cumin/src/jobs/chrisJob.ts** - Low-level plugin instance API
2. **cumin/src/jobs/jobMonitor.ts** - Background polling for status changes
3. **salsa/src/jobs/** - Business logic (status, logs, list)
4. **chili/src/commands/job/** - Controllers
5. **chili/src/views/job.ts** - Formatting
6. **chell/src/builtins/job.ts** - Shell builtin

### 5.3 Implementation Details

#### A. ChRISJob Class (cumin)

**File:** `cumin/src/jobs/chrisJob.ts`

```typescript
/**
 * @file ChRIS Job (Plugin Instance) Management.
 *
 * Low-level interface to ChRIS plugin instances.
 */

export type JobState =
  | 'scheduled'
  | 'started'
  | 'running'
  | 'completed'
  | 'error'
  | 'cancelled';

export interface JobStatus {
  id: string;
  pluginName: string;
  state: JobState;
  progress: number;        // 0-100
  createdAt: Date;
  startedAt: Date | null;
  finishedAt: Date | null;
  error: string | null;
}

export class ChRISJob {
  private instanceId: string;

  constructor(instanceId: string) {
    this.instanceId = instanceId;
  }

  /**
   * Gets current job status from ChRIS API.
   */
  async status_get(): Promise<Result<JobStatus>> {
    try {
      const client = await session.connection.client_get();
      if (!client) return Err('Not connected to ChRIS');

      const instance = await client.getPluginInstance(this.instanceId);

      return Ok({
        id: this.instanceId,
        pluginName: instance.data.plugin_name,
        state: instance.data.status as JobState,
        progress: this.progress_calculate(instance.data),
        createdAt: new Date(instance.data.start_date),
        startedAt: instance.data.started_date
          ? new Date(instance.data.started_date)
          : null,
        finishedAt: instance.data.finished_date
          ? new Date(instance.data.finished_date)
          : null,
        error: instance.data.error_message || null,
      });
    } catch (error) {
      errorStack.stack_push('error', `Failed to get job status: ${error}`);
      return Err();
    }
  }

  /**
   * Streams job logs from ChRIS API.
   */
  async *logs_stream(): AsyncGenerator<string> {
    const client = await session.connection.client_get();
    if (!client) {
      errorStack.stack_push('error', 'Not connected to ChRIS');
      return;
    }

    // Implementation: poll logs endpoint, yield new lines
    let lastOffset = 0;
    while (true) {
      const logs = await client.getPluginInstanceLogs(this.instanceId, lastOffset);
      if (logs.length > 0) {
        yield logs;
        lastOffset += logs.length;
      }

      // Check if job finished
      const status = await this.status_get();
      if (status.ok && ['completed', 'error', 'cancelled'].includes(status.value.state)) {
        break;
      }

      await sleep(2000);  // Poll every 2s
    }
  }

  /**
   * Cancels a running job.
   */
  async cancel(): Promise<Result<boolean>> {
    try {
      const client = await session.connection.client_get();
      if (!client) return Err('Not connected to ChRIS');

      await client.deletePluginInstance(this.instanceId);
      return Ok(true);
    } catch (error) {
      errorStack.stack_push('error', `Failed to cancel job: ${error}`);
      return Err();
    }
  }

  private progress_calculate(instanceData: any): number {
    // Implementation: parse progress from instance data
    // ChRIS doesn't have native progress, so we estimate based on state
    switch (instanceData.status) {
      case 'scheduled': return 0;
      case 'started': return 5;
      case 'running': return 50;  // TODO: Better heuristic
      case 'completed': return 100;
      default: return 0;
    }
  }
}
```

#### B. JobMonitor (cumin)

**File:** `cumin/src/jobs/jobMonitor.ts`

```typescript
/**
 * @file Background Job Monitor.
 *
 * Polls running jobs and notifies on status changes.
 */

type JobCallback = (instanceId: string, status: JobStatus) => void;

export class JobMonitor {
  private static instance: JobMonitor;
  private watchedJobs: Map<string, { lastState: JobState }> = new Map();
  private pollingInterval: NodeJS.Timeout | null = null;
  private callbacks: JobCallback[] = [];

  static instance_get(): JobMonitor {
    if (!JobMonitor.instance) {
      JobMonitor.instance = new JobMonitor();
    }
    return JobMonitor.instance;
  }

  /**
   * Start watching a job for completion.
   */
  watch(instanceId: string): void {
    this.watchedJobs.set(instanceId, { lastState: 'scheduled' });
    this.polling_start();
  }

  /**
   * Stop watching a job.
   */
  unwatch(instanceId: string): void {
    this.watchedJobs.delete(instanceId);
    if (this.watchedJobs.size === 0) {
      this.polling_stop();
    }
  }

  /**
   * Register callback for status changes.
   */
  onChange(callback: JobCallback): void {
    this.callbacks.push(callback);
  }

  private polling_start(): void {
    if (this.pollingInterval) return;

    this.pollingInterval = setInterval(() => {
      this.poll();  // Don't await - background task
    }, 10000);  // Poll every 10s
  }

  private polling_stop(): void {
    if (this.pollingInterval) {
      clearInterval(this.pollingInterval);
      this.pollingInterval = null;
    }
  }

  private async poll(): Promise<void> {
    for (const [instanceId, watchData] of this.watchedJobs) {
      const job = new ChRISJob(instanceId);
      const statusResult = await job.status_get();

      if (!statusResult.ok) continue;

      const status = statusResult.value;

      // Check for state change
      if (status.state !== watchData.lastState) {
        watchData.lastState = status.state;

        // Notify callbacks
        for (const callback of this.callbacks) {
          callback(instanceId, status);
        }

        // Unwatch if terminal state
        if (['completed', 'error', 'cancelled'].includes(status.state)) {
          this.unwatch(instanceId);
        }
      }
    }
  }
}

export function jobMonitor_get(): JobMonitor {
  return JobMonitor.instance_get();
}
```

#### C. Business Logic (salsa)

**File:** `salsa/src/jobs/status.ts`

```typescript
import { ChRISJob, JobStatus } from '@fnndsc/cumin';

export async function job_status(instanceId: string): Promise<Result<JobStatus>> {
  const job = new ChRISJob(instanceId);
  return await job.status_get();
}
```

**File:** `salsa/src/jobs/logs.ts`

```typescript
export async function* job_logs(
  instanceId: string,
  options: { follow?: boolean, tail?: number } = {}
): AsyncGenerator<string> {
  const job = new ChRISJob(instanceId);

  if (options.follow) {
    // Stream logs continuously
    for await (const chunk of job.logs_stream()) {
      yield chunk;
    }
  } else {
    // Get all logs once
    for await (const chunk of job.logs_stream()) {
      yield chunk;
      break;  // Only first chunk
    }
  }
}
```

**File:** `salsa/src/jobs/list.ts`

```typescript
export async function jobs_listAll(
  filters?: { state?: JobState }
): Promise<Result<JobStatus[]>> {
  // Implementation: query ChRIS for plugin instances
  // Filter by state if specified
}
```

#### D. Shell Commands (chili)

**File:** `chili/src/commands/job/status.ts`

```typescript
import { job_status } from '@fnndsc/salsa';

export async function job_fetchStatus(instanceId: string): Promise<Result<JobStatus>> {
  return await job_status(instanceId);
}
```

**File:** `chili/src/views/job.ts`

```typescript
export function jobStatus_render(status: JobStatus): string {
  const stateColor = {
    scheduled: chalk.yellow,
    started: chalk.cyan,
    running: chalk.cyan,
    completed: chalk.green,
    error: chalk.red,
    cancelled: chalk.gray,
  }[status.state];

  const lines = [
    `Job ${status.id}: ${stateColor(status.state.toUpperCase())}`,
    `Plugin: ${status.pluginName}`,
    `Progress: ${renderProgressBar(status.progress)}`,
  ];

  if (status.startedAt) {
    const elapsed = elapsedTime(status.startedAt);
    lines.push(`Elapsed: ${elapsed}`);
  }

  if (status.error) {
    lines.push(chalk.red(`Error: ${status.error}`));
  }

  return lines.join('\n');
}

function renderProgressBar(progress: number): string {
  const width = 20;
  const filled = Math.floor((progress / 100) * width);
  const empty = width - filled;
  return `[${'█'.repeat(filled)}${'░'.repeat(empty)}] ${progress}%`;
}
```

#### E. Shell Builtin (chell)

**File:** `chell/src/builtins/job.ts`

```typescript
import { job_fetchStatus, job_fetchLogs, jobs_fetchList } from '@fnndsc/chili/commands/job';
import { jobStatus_render, jobLogs_render, jobList_render } from '@fnndsc/chili/views/job';
import { jobMonitor_get } from '@fnndsc/cumin';

export async function builtin_job(args: string[]): Promise<void> {
  const subcommand = args[0];

  if (!subcommand) {
    console.log(chalk.red('Usage: job <status|logs|list|cancel> ...'));
    return;
  }

  switch (subcommand) {
    case 'status':
      await job_handleStatus(args.slice(1));
      break;
    case 'logs':
      await job_handleLogs(args.slice(1));
      break;
    case 'list':
      await job_handleList(args.slice(1));
      break;
    case 'cancel':
      await job_handleCancel(args.slice(1));
      break;
    default:
      console.log(chalk.red(`Unknown subcommand: ${subcommand}`));
  }
}

async function job_handleStatus(args: string[]): Promise<void> {
  const instanceId = args[0];
  if (!instanceId) {
    console.log(chalk.red('Usage: job status <instance_id>'));
    return;
  }

  const result = await job_fetchStatus(instanceId);
  if (result.ok) {
    console.log(jobStatus_render(result.value));
  } else {
    const error = errorStack.stack_pop();
    console.error(chalk.red(error?.message || 'Failed to get status'));
  }
}

async function job_handleLogs(args: string[]): Promise<void> {
  const parsed = commandArgs_process(args);
  const instanceId = parsed._[0] as string;

  if (!instanceId) {
    console.log(chalk.red('Usage: job logs <instance_id> [--follow]'));
    return;
  }

  const follow = !!parsed.follow || !!parsed.f;

  for await (const chunk of job_fetchLogs(instanceId, { follow })) {
    process.stdout.write(chunk);
  }
}

async function job_handleList(args: string[]): Promise<void> {
  const parsed = commandArgs_process(args);
  const state = parsed.state as JobState | undefined;

  const result = await jobs_fetchList({ state });
  if (result.ok) {
    console.log(jobList_render(result.value));
  } else {
    const error = errorStack.stack_pop();
    console.error(chalk.red(error?.message || 'Failed to list jobs'));
  }
}
```

#### F. Plugin Execution Returns JID

**File:** `chell/src/builtins/index.ts` (modify existing plugin execution)

```typescript
async function builtin_pluginRun(args: string[]): Promise<void> {
  const pluginName = args[0];
  const params = args.slice(1).join(' ');

  // Show spinner after 500ms
  const spinnerTimer = setTimeout(() => {
    console.log(chalk.gray('⠋ Submitting to ChRIS...'));
  }, 500);

  const result = await plugin_execute(pluginName, params);

  clearTimeout(spinnerTimer);

  if (result.ok) {
    const instance = result.value;

    // Return IMMEDIATELY with JID
    console.log(chalk.green(`✓ Instance ${instance.id} submitted`));
    console.log(chalk.gray(`  Status: ${instance.status}`));
    console.log(chalk.gray(`  Use 'job status ${instance.id}' to monitor`));

    // Start background monitoring
    const monitor = jobMonitor_get();
    monitor.watch(instance.id);
  } else {
    const error = errorStack.stack_pop();
    console.error(chalk.red(error?.message || 'Failed to submit job'));
  }
}

// Setup notification callback on shell startup
function shell_init(): void {
  const monitor = jobMonitor_get();
  monitor.onChange((instanceId, status) => {
    // Show notification at next prompt
    if (status.state === 'completed') {
      console.log(chalk.green(`\n⚡ Job ${instanceId} completed ✓`));
    } else if (status.state === 'error') {
      console.log(chalk.red(`\n⚡ Job ${instanceId} failed ✗`));
    }
  });
}
```

### 5.4 Testing Criteria

#### Unit Tests

**File:** `cumin/tests/jobs/chrisJob.test.ts`

```typescript
describe('ChRISJob', () => {
  it('should fetch job status', async () => {
    const job = new ChRISJob('4523');
    const result = await job.status_get();

    expect(result.ok).toBe(true);
    expect(result.value.id).toBe('4523');
    expect(result.value.state).toMatch(/scheduled|started|running|completed|error|cancelled/);
  });

  it('should stream logs', async () => {
    const job = new ChRISJob('4523');
    const logs: string[] = [];

    for await (const chunk of job.logs_stream()) {
      logs.push(chunk);
    }

    expect(logs.length).toBeGreaterThan(0);
  });

  it('should cancel job', async () => {
    const job = new ChRISJob('4523');
    const result = await job.cancel();

    expect(result.ok).toBe(true);
  });
});
```

**File:** `cumin/tests/jobs/jobMonitor.test.ts`

```typescript
describe('JobMonitor', () => {
  it('should watch job and notify on completion', async () => {
    const monitor = jobMonitor_get();
    let notified = false;

    monitor.onChange((id, status) => {
      if (status.state === 'completed') {
        notified = true;
      }
    });

    monitor.watch('test-job');

    // Wait for polling
    await sleep(15000);

    expect(notified).toBe(true);
  });

  it('should stop watching after terminal state', async () => {
    const monitor = jobMonitor_get();
    monitor.watch('test-job');

    // Simulate job completion
    await sleep(15000);

    expect(monitor['watchedJobs'].has('test-job')).toBe(false);
  });
});
```

#### Integration Tests

**File:** `chell/tests/integration/jobs.test.ts`

```typescript
describe('Job Integration', () => {
  it('should submit job and return immediately', async () => {
    const start = Date.now();
    await builtin_pluginRun(['pl-dircopy', '--inputdir', '/test']);
    const elapsed = Date.now() - start;

    // Should return in < 1s (not wait for job completion)
    expect(elapsed).toBeLessThan(1000);
  });

  it('should check job status', async () => {
    // Submit job
    const instance = await plugin_execute('pl-dircopy', '--inputdir /test');

    // Check status
    await builtin_job(['status', instance.id]);

    // Should show status without error
  });

  it('should stream logs with --follow', async () => {
    const instance = await plugin_execute('pl-dircopy', '--inputdir /test');

    // This would stream in real shell, but for test just verify it doesn't hang
    const timeout = setTimeout(() => {
      throw new Error('Logs streaming timeout');
    }, 5000);

    let lineCount = 0;
    for await (const chunk of job_fetchLogs(instance.id, { follow: true })) {
      lineCount++;
      if (lineCount > 10) break;  // Stop after 10 lines for test
    }

    clearTimeout(timeout);
    expect(lineCount).toBeGreaterThan(0);
  });
});
```

### 5.5 Acceptance Criteria

**Functional Requirements:**

- [ ] Plugin execution returns JID immediately (< 500ms)
- [ ] Shell prompt returns after plugin submission (no blocking)
- [ ] `job status <id>` shows current state, progress, elapsed time
- [ ] `job logs <id>` shows plugin output
- [ ] `job logs <id> --follow` streams logs in real-time
- [ ] `job list` shows all running/recent jobs
- [ ] `job cancel <id>` terminates running job
- [ ] Background monitor polls job status every 10s
- [ ] Notifications shown when jobs complete/error

**Performance Requirements:**

- [ ] Plugin submission: < 500ms (API call + cache update)
- [ ] Job status query: < 300ms (single API call)
- [ ] Background polling: minimal CPU usage (< 1%)
- [ ] No memory leaks from monitoring (stable over hours)

**UX Requirements:**

- [ ] Plugin submission shows "✓ Instance 4523 submitted"
- [ ] Status shows progress bar and ETA (when available)
- [ ] Logs stream without buffering (real-time output)
- [ ] Completion notification at next prompt (non-intrusive)
- [ ] Error notifications show failure reason

**Correctness Requirements:**

- [ ] Job monitor correctly detects state transitions
- [ ] Terminal states (completed/error/cancelled) stop monitoring
- [ ] Cancelled jobs don't show completion notification
- [ ] Log streaming stops when job finishes

**Alias Requirements:**

- [ ] `plugin status <id>` works (alias for `job status`)
- [ ] `plugin logs <id>` works (alias for `job logs`)
- [ ] `plugin list --running` works (alias for `job list --state running`)

---

## 6. Component 3: Contextual Prompt

### 6.1 Design Overview

**Goal:** Show rich metadata in prompt to provide context and feedback.

**Current prompt:**
```bash
chell$
```

**Enhanced prompt:**
```bash
[feed:123/node:45 | 2 jobs ⟳]$
```

**Information shown:**
- Current feed and node (if in feed tree)
- Number of running background jobs
- Physical mode indicator (if enabled)
- Cache status indicator (optional)

### 6.2 Prompt Components

#### A. Feed Context

**When:** User is in `/feeds/*/nodes/*` path

**Display:**
```bash
[feed:123/node:45]$
```

**Semantic meaning:**
- "I'm in feed 123, node 45"
- "This node's outputs are the implicit inputs for next plugin"

**Implementation:**
```typescript
function prompt_getFeedContext(): string | null {
  const cwd = session.getCWD();

  // Match /feeds/{feedId}/nodes/{nodeId}
  const match = cwd.match(/^\/feeds\/(\d+)\/nodes\/(\d+)/);
  if (match) {
    return `feed:${match[1]}/node:${match[2]}`;
  }

  // Match /feeds/{feedId}
  const feedMatch = cwd.match(/^\/feeds\/(\d+)/);
  if (feedMatch) {
    return `feed:${feedMatch[1]}`;
  }

  return null;
}
```

#### B. Job Status

**When:** Background jobs are running

**Display:**
```bash
[feed:123/node:45 | 2 jobs ⟳]$
[feed:123/node:45 | job:4523 12%]$   # Single job with progress
```

**Implementation:**
```typescript
function prompt_getJobStatus(): string | null {
  const monitor = jobMonitor_get();
  const watchedJobs = monitor.watchedJobs_get();

  if (watchedJobs.length === 0) return null;

  if (watchedJobs.length === 1) {
    const job = watchedJobs[0];
    if (job.progress > 0) {
      return `job:${job.id} ${job.progress}%`;
    }
    return `job:${job.id} ⟳`;
  }

  return `${watchedJobs.length} jobs ⟳`;
}
```

#### C. Physical Mode Indicator

**When:** Physical mode is enabled

**Display:**
```bash
[feed:123/node:45 | physical]$
```

**Implementation:**
```typescript
function prompt_getPhysicalMode(): string | null {
  return session.physicalMode_get() ? 'physical' : null;
}
```

#### D. Combined Prompt

**Implementation:**
```typescript
function prompt_build(): string {
  const parts: string[] = [];

  // Feed context
  const feedContext = prompt_getFeedContext();
  if (feedContext) {
    parts.push(chalk.cyan(feedContext));
  }

  // Job status
  const jobStatus = prompt_getJobStatus();
  if (jobStatus) {
    parts.push(chalk.yellow(jobStatus));
  }

  // Physical mode
  const physicalMode = prompt_getPhysicalMode();
  if (physicalMode) {
    parts.push(chalk.magenta(physicalMode));
  }

  // Build prompt
  if (parts.length > 0) {
    return `[${parts.join(' | ')}]$ `;
  }

  return 'chell$ ';
}
```

### 6.3 Dynamic Prompt Updates

**Challenge:** readline doesn't support dynamic prompt updates.

**Solution:** Redraw prompt on status changes.

**Implementation:**
```typescript
// Setup in shell init
function shell_init(): void {
  const monitor = jobMonitor_get();

  monitor.onChange((id, status) => {
    // Redraw prompt with updated job count
    readline.setPrompt(prompt_build());
    readline.prompt(true);  // Preserve current line
  });

  // Redraw prompt every 30s if jobs are running
  setInterval(() => {
    const jobStatus = prompt_getJobStatus();
    if (jobStatus) {
      readline.setPrompt(prompt_build());
      readline.prompt(true);
    }
  }, 30000);
}
```

### 6.4 Testing Criteria

#### Unit Tests

**File:** `chell/tests/prompt/prompt.test.ts`

```typescript
describe('Prompt Builder', () => {
  it('should show feed context in feed tree', () => {
    session.setCWD('/feeds/123/nodes/45');
    const prompt = prompt_build();
    expect(prompt).toContain('feed:123/node:45');
  });

  it('should show job count when jobs running', () => {
    const monitor = jobMonitor_get();
    monitor.watch('job1');
    monitor.watch('job2');

    const prompt = prompt_build();
    expect(prompt).toContain('2 jobs');
  });

  it('should show physical mode indicator', () => {
    session.physicalMode_set(true);
    const prompt = prompt_build();
    expect(prompt).toContain('physical');
  });

  it('should combine multiple indicators', () => {
    session.setCWD('/feeds/123/nodes/45');
    session.physicalMode_set(true);
    jobMonitor_get().watch('job1');

    const prompt = prompt_build();
    expect(prompt).toContain('feed:123/node:45');
    expect(prompt).toContain('job');
    expect(prompt).toContain('physical');
  });
});
```

### 6.5 Acceptance Criteria

**Functional Requirements:**

- [ ] Feed context shown when in /feeds/*/nodes/*
- [ ] Job count shown when background jobs running
- [ ] Physical mode indicator shown when enabled
- [ ] Prompt combines all active indicators
- [ ] Default prompt shown when no context

**UX Requirements:**

- [ ] Prompt is concise (< 50 characters)
- [ ] Indicators use color for readability
- [ ] Prompt updates when job status changes
- [ ] No flicker during prompt updates

**Performance Requirements:**

- [ ] Prompt build < 1ms
- [ ] Prompt updates don't block user input

---

## 7. Component 4: Async Operations

### 7.1 Design Overview

**Goal:** Make all operations non-blocking with optimistic rendering.

**Patterns:**

1. **Optimistic Serving** - Show cache immediately, refresh in background
2. **Prefetching** - Preload adjacent paths on navigation
3. **Background Refresh** - Update stale cache without blocking UI
4. **Progressive Display** - Stream results as they arrive

### 7.2 Optimistic ls

**Pattern:**
```typescript
async function builtin_ls(args: string[]): Promise<void> {
  const path = await path_resolve(args[0] || '.');
  const cache = listCache_get();

  // 1. Check cache - show IMMEDIATELY if available
  const cached = cache.cache_get(path);
  if (cached) {
    console.log(grid_render(cached.data));

    if (cached.fresh) {
      return;  // Fresh cache, done!
    }

    // Stale cache, show indicator
    console.log(chalk.gray(`  ↻ Refreshing (${Math.floor(cached.age / 1000)}s old)...`));
  } else {
    // No cache, show spinner after 500ms
    let spinnerShown = false;
    const spinnerTimer = setTimeout(() => {
      spinnerShown = true;
      console.log(chalk.gray('⠋ Fetching directory from remote...'));
    }, 500);
  }

  // 2. Fetch fresh data (async)
  const fresh = await files_list({}, path);

  // 3. Update display if changed
  if (cached) {
    if (!equals(cached.data, fresh)) {
      // Clear old output
      process.stdout.moveCursor(0, -2);
      process.stdout.clearScreenDown();
      console.log(grid_render(fresh));
    } else {
      // No change, just clear refresh message
      process.stdout.moveCursor(0, -1);
      process.stdout.clearLine(1);
    }
  } else {
    if (spinnerShown) {
      // Clear spinner
      process.stdout.moveCursor(0, -1);
      process.stdout.clearLine(1);
    }
    console.log(grid_render(fresh));
  }

  // 4. Update cache
  cache.cache_set(path, fresh);
}
```

### 7.3 Prefetching on cd

**Pattern:**
```typescript
async function builtin_cd(args: string[]): Promise<void> {
  const path = await path_resolve(args[0] || '~');

  // Validate and set CWD
  await session.setCWD(path);

  // Return immediately - DON'T AWAIT prefetching
  prefetch_adjacentPaths(path);
}

async function prefetch_adjacentPaths(path: string): Promise<void> {
  const cache = listCache_get();

  // 1. Prefetch current directory
  if (!cache.cache_get(path)) {
    const items = await files_list({}, path);
    cache.cache_set(path, items);
  }

  // 2. Prefetch parent directory (for cd ..)
  const parent = dirname(path);
  if (parent !== path && !cache.cache_get(parent)) {
    const items = await files_list({}, parent);
    cache.cache_set(parent, items);
  }

  // 3. Prefetch child directories (for tab completion)
  const current = cache.cache_get(path);
  if (current) {
    const dirs = current.data.filter(item => item.type === 'dir');
    for (const dir of dirs.slice(0, 5)) {  // Limit to 5
      const childPath = `${path}/${dir.name}`;
      if (!cache.cache_get(childPath)) {
        const items = await files_list({}, childPath);
        cache.cache_set(childPath, items);
      }
    }
  }
}
```

### 7.4 Testing Criteria

#### Integration Tests

**File:** `chell/tests/integration/async.test.ts`

```typescript
describe('Async Operations', () => {
  it('should show cached ls immediately', async () => {
    await builtin_cd('/PUBLIC');
    await builtin_ls([]);  // Warm cache

    const start = Date.now();
    await builtin_ls([]);  // Should be instant
    const elapsed = Date.now() - start;

    expect(elapsed).toBeLessThan(50);
  });

  it('should prefetch on cd', async () => {
    await builtin_cd('/PUBLIC');
    await sleep(1000);  // Allow prefetch to complete

    // ls should be cached (from prefetch)
    const start = Date.now();
    await builtin_ls([]);
    const elapsed = Date.now() - start;

    expect(elapsed).toBeLessThan(50);
  });

  it('should show stale cache while refreshing', async () => {
    // Setup stale cache
    const cache = listCache_get();
    cache.cache_set('/test', mockData, { ttl: 100 });
    await sleep(150);

    // ls should show stale + refresh
    const output = await captureOutput(() => builtin_ls(['/test']));
    expect(output).toContain('Refreshing');
  });
});
```

### 7.5 Acceptance Criteria

**Functional Requirements:**

- [ ] Cached ls returns in < 50ms
- [ ] Stale cache shown immediately with "Refreshing..." indicator
- [ ] Background refresh updates display if changed
- [ ] Prefetching populates cache after cd
- [ ] Spinner shown only after 500ms for uncached operations

**Performance Requirements:**

- [ ] Optimistic ls: 0ms perceived latency (cached)
- [ ] Prefetching: no blocking of user input
- [ ] Background refresh: < 300ms total time

**UX Requirements:**

- [ ] Stale cache indicator is non-intrusive (gray, single line)
- [ ] Display updates smoothly without flicker
- [ ] Spinner only shown when operation is genuinely slow

---

## 8. Implementation Roadmap

### Phase 1: Foundation (Week 1-2) ✅ COMPLETE

**Goal:** Enhanced cache with TTL and dirty flags

**Tasks:**
1. ✅ Implement enhanced ListCache (TTL, dirty, LRU)
2. ✅ Remove cwd_update() flush from chrisContext (made it no-op)
3. ✅ Add unit tests for cache (40 tests, 98% coverage)
4. ✅ Update documentation
5. ✅ Fix vfs.ts cache checking bug (was always hitting API)
6. ✅ Add optimistic rendering (stale cache + "Fetching..." indicators)
7. ✅ Add timing command for performance measurement

**Deliverables:**
- ✅ `cumin/src/cache/listCache.ts` (enhanced with TTL, dirty, LRU, stats)
- ✅ `cumin/tests/listCache.test.ts` (40 comprehensive unit tests)
- ✅ `chell/src/lib/vfs/vfs.ts` (fixed cache checking, optimistic rendering)
- ✅ `chell/src/session/index.ts` (added timing mode)
- ✅ `chell/src/builtins/index.ts` (added timing, touch, mkdir commands)
- ✅ `chell/src/builtins/help.ts` (comprehensive help system)

**Success metrics:**
- ✅ All tests pass (40/40)
- ✅ Cache survives cd navigation
- ✅ TTL-based expiration works
- ✅ Stale cache shows "(cached, refreshing...)" indicator
- ✅ Cache miss shows "Fetching..." after 500ms
- ✅ Background refresh updates cache without blocking

### Phase 2: Optimistic Operations (Week 3)

**Goal:** Optimistic rendering for ls and mutations

**Tasks:**
1. Update builtin_ls() with optimistic serving
2. Add cache_markDirty() to rm, mkdir, touch, upload
3. Add cache_update() for optimistic mutations
4. Add integration tests

**Deliverables:**
- [ ] `chell/src/builtins/index.ts` (updated ls, rm, mkdir, touch)
- [ ] `chell/src/lib/vfs/vfs.ts` (updated data_get)
- [ ] `chell/tests/integration/cache.test.ts`

**Success metrics:**
- ls on /PUBLIC returns in < 50ms (cached)
- Stale cache shows "Refreshing..." indicator
- rm shows instant UI update

### Phase 3: Job Management (Week 4-5)

**Goal:** Background job control with instant plugin execution

**Tasks:**
1. Implement ChRISJob class (cumin)
2. Implement JobMonitor (cumin)
3. Add job status/logs/list commands (salsa, chili)
4. Add shell builtin (chell)
5. Update plugin execution to return JID immediately
6. Add tests

**Deliverables:**
- [ ] `cumin/src/jobs/chrisJob.ts`
- [ ] `cumin/src/jobs/jobMonitor.ts`
- [ ] `salsa/src/jobs/*.ts`
- [ ] `chili/src/commands/job/*.ts`
- [ ] `chili/src/views/job.ts`
- [ ] `chell/src/builtins/job.ts`
- [ ] Tests for all layers

**Success metrics:**
- Plugin execution returns in < 500ms
- Shell prompt returns immediately
- job status shows progress
- job logs streams in real-time
- Background notifications work

### Phase 4: Contextual Prompt (Week 6)

**Goal:** Rich prompt showing feed context, job status

**Tasks:**
1. Implement prompt builder
2. Add feed context detection
3. Add job status display
4. Add physical mode indicator
5. Setup dynamic prompt updates
6. Add tests

**Deliverables:**
- [ ] `chell/src/lib/prompt/index.ts`
- [ ] `chell/tests/prompt/prompt.test.ts`

**Success metrics:**
- Prompt shows feed:X/node:Y in feed tree
- Prompt shows job count when jobs running
- Prompt updates when job completes

### Phase 5: Async Prefetching (Week 7)

**Goal:** Prefetch adjacent paths on navigation

**Tasks:**
1. Implement prefetch_adjacentPaths()
2. Call from builtin_cd() without await
3. Add prefetch queue (throttling)
4. Add tests

**Deliverables:**
- [ ] `chell/src/lib/prefetch/index.ts`
- [ ] `chell/tests/integration/prefetch.test.ts`

**Success metrics:**
- cd + ls completes in < 100ms (prefetched)
- Prefetching doesn't block prompt
- No API rate limiting issues

### Phase 6: Polish & Documentation (Week 8)

**Goal:** Comprehensive documentation and edge case handling

**Tasks:**
1. Update all README files
2. Add architecture diagrams
3. Write user guide
4. Handle edge cases (network errors, timeouts)
5. Performance profiling
6. Integration testing with real ChRIS instance

**Deliverables:**
- [ ] `chell/docs/RESPONSIVE_SHELL.md` (user guide)
- [ ] `chell/docs/architecture.adoc` (updated)
- [ ] Performance benchmarks
- [ ] Integration test suite

---

## 9. Success Metrics

### 9.1 Performance Targets

| Operation | Current | Target | Stretch Goal |
|-----------|---------|--------|--------------|
| `ls` (cached) | 5ms | < 50ms | < 10ms |
| `ls` (uncached) | 200ms | < 300ms | < 200ms |
| `cd` + `ls` (prefetched) | 400ms | < 100ms | < 50ms |
| `cd` (validation) | 150ms | < 200ms | < 150ms |
| Tab completion | 150ms | < 50ms | < 20ms |
| Wildcard expansion | 200ms | < 100ms | < 50ms |
| Plugin submission | 300ms | < 500ms | < 300ms |

### 9.2 User Experience Metrics

**Responsiveness perception:**
- [ ] 80% of operations feel instant (< 100ms)
- [ ] 15% of operations show spinner (100-500ms)
- [ ] 5% of operations are expected slow (> 500ms)

**User satisfaction:**
- [ ] "Feels local" in 90% of interactions
- [ ] Spinners only shown when genuinely waiting
- [ ] Background jobs don't block workflow
- [ ] Notifications are timely and relevant

### 9.3 Technical Metrics

**Cache efficiency:**
- [ ] Cache hit rate > 70%
- [ ] Stale hit rate < 20%
- [ ] Cache miss rate < 10%
- [ ] LRU evictions < 5% of sets

**Job management:**
- [ ] Background monitoring < 1% CPU
- [ ] Job submission latency < 500ms
- [ ] Status query latency < 300ms
- [ ] No memory leaks (stable over 24h)

### 9.4 Measurement Tools

**Performance profiling:**
```typescript
class PerformanceMonitor {
  private metrics: Map<string, number[]> = new Map();

  measure<T>(operation: string, fn: () => Promise<T>): Promise<T> {
    const start = Date.now();
    const result = await fn();
    const elapsed = Date.now() - start;

    if (!this.metrics.has(operation)) {
      this.metrics.set(operation, []);
    }
    this.metrics.get(operation)!.push(elapsed);

    return result;
  }

  report(): void {
    for (const [op, times] of this.metrics) {
      const avg = times.reduce((a, b) => a + b) / times.length;
      const p50 = percentile(times, 50);
      const p95 = percentile(times, 95);
      const p99 = percentile(times, 99);

      console.log(`${op}: avg=${avg}ms p50=${p50}ms p95=${p95}ms p99=${p99}ms`);
    }
  }
}

// Usage
await perfMonitor.measure('ls', () => builtin_ls([]));
```

**Cache statistics:**
```bash
$ cache stats
Cache Statistics:
  Hits: 234 (72%)
  Stale Hits: 45 (14%)
  Misses: 46 (14%)
  Entries: 87 / 100
  Memory: 423 KB
  Evictions: 12
```

---

## 10. Risk Analysis

### 10.1 Technical Risks

#### Risk: Stale Cache Confusion

**Description:** User sees outdated data due to long TTL

**Likelihood:** Medium
**Impact:** High (data integrity)

**Mitigation:**
- Conservative default TTL (3 minutes)
- Always mark mutations dirty
- Show cache age when refreshing
- Allow manual cache clear: `cache invalidate`

**Rollback:** Reduce TTL to 1 minute globally

#### Risk: Background Job Flooding

**Description:** Polling too many jobs causes API rate limiting

**Likelihood:** Low
**Impact:** Medium

**Mitigation:**
- Poll interval: 10s (not too aggressive)
- Limit watched jobs to 50 max
- Exponential backoff on API errors
- User can unwatch jobs: `job unwatch <id>`

**Rollback:** Increase poll interval to 30s

#### Risk: Memory Leak in JobMonitor

**Description:** Completed jobs never removed from watchedJobs

**Likelihood:** Low
**Impact:** High

**Mitigation:**
- Unwatch on terminal states (completed/error/cancelled)
- Automated tests run for 1 hour
- Add memory monitoring
- Fallback: restart monitor if memory > 100MB

**Rollback:** Disable background monitoring

#### Risk: Prompt Update Flicker

**Description:** Dynamic prompt causes visual artifacts

**Likelihood:** Medium
**Impact:** Low (UX annoyance)

**Mitigation:**
- Use readline.prompt(true) to preserve input
- Limit updates to 30s intervals
- Only redraw if prompt actually changed
- Disable dynamic updates if terminal doesn't support

**Rollback:** Static prompt only

### 10.2 User Experience Risks

#### Risk: Optimistic Update Confusion

**Description:** User sees instant UI update, but API call fails silently

**Likelihood:** Low
**Impact:** High (data integrity)

**Mitigation:**
- ALWAYS show error if operation fails
- Revert optimistic changes on failure
- Log failures to errorStack
- Add retry logic for transient errors

**Rollback:** Disable optimistic updates, wait for API

#### Risk: Notification Spam

**Description:** Too many job completion notifications

**Likelihood:** Medium
**Impact:** Low

**Mitigation:**
- Batch notifications (max 3 per minute)
- User can disable: `set notifications off`
- Only notify for jobs submitted in current session
- Quiet hours: no notifications between 11pm-7am

**Rollback:** Disable automatic notifications

### 10.3 Compatibility Risks

#### Risk: Breaks Piping/Scripting

**Description:** Spinners and colors break `chell ls | grep`

**Likelihood:** Low
**Impact:** High

**Mitigation:**
- Detect TTY: `if (!process.stdout.isTTY) { noSpinners }`
- Respect NO_COLOR environment variable
- Add `--no-color` and `--no-spinner` flags
- Integration tests with pipes

**Rollback:** Disable all decorations by default

---

## 11. Future Directions

### 11.1 Advanced Caching

#### ETag Support

If ChRIS API adds ETag headers:
```typescript
cache_get(path): CacheResult {
  const entry = this.cache.get(path);
  if (entry && entry.etag) {
    // Send If-None-Match header
    // If 304 Not Modified, use cache
  }
}
```

**Benefit:** Only transfer data if actually changed

#### Cache Compression

For large directories:
```typescript
import { gzip, gunzip } from 'zlib';

cache_set(path, data) {
  const compressed = await gzip(JSON.stringify(data));
  this.cache.set(path, { compressed, ... });
}
```

**Benefit:** 5-10x memory reduction for large listings

#### Persistent Cache

Cache survives shell restarts:
```typescript
import { open } from 'sqlite';

class PersistentCache {
  async cache_set(path, data) {
    await db.run(
      'INSERT OR REPLACE INTO cache (path, data, timestamp) VALUES (?, ?, ?)',
      [path, JSON.stringify(data), Date.now()]
    );
  }
}
```

**Benefit:** Instant first `ls` after restart

### 11.2 Smarter Prefetching

#### Machine Learning Prediction

Learn user navigation patterns:
```typescript
class PrefetchPredictor {
  private history: string[] = [];

  predict(currentPath: string): string[] {
    // Train on navigation history
    // Predict likely next paths
    return ['/likely/next/path'];
  }
}
```

**Benefit:** Prefetch paths user is likely to visit

#### Breadth-First Prefetch

Prefetch entire subtree:
```typescript
async function prefetch_tree(path: string, maxDepth = 2) {
  for (let depth = 0; depth < maxDepth; depth++) {
    // Prefetch all nodes at this depth
  }
}
```

**Benefit:** Deep exploration feels instant

### 11.3 Enhanced Prompt

#### Git-Style Prompt

Show more context:
```bash
[chris:cube.example.org feed:123/node:45 (pl-freesurfer) | 2 jobs ⟳]$
```

Components:
- Server hostname
- Parent plugin name
- Job details

#### Progress in Prompt

Show real-time job progress:
```bash
[feed:123/node:45 | job:4523 ████░░░░ 45%]$
```

**Implementation:** Update every 5s during execution

### 11.4 Async Enhancements

#### Server-Sent Events

If ChRIS adds SSE support:
```typescript
const eventSource = new EventSource('/api/events');
eventSource.onmessage = (event) => {
  // Invalidate cache on server-side changes
  listCache.cache_invalidate(event.data.path);
};
```

**Benefit:** Cache never stale (server pushes changes)

#### Parallel Fetching

Fetch multiple directories in parallel:
```typescript
async function prefetch_parallel(paths: string[]) {
  await Promise.all(paths.map(path => files_list({}, path)));
}
```

**Benefit:** Faster prefetching

---

## 12. Appendices

### A. Glossary

**Terms:**

- **TTL (Time To Live):** How long a cache entry is considered fresh
- **Dirty Flag:** Marker indicating cached data might be stale
- **LRU (Least Recently Used):** Eviction policy that removes oldest-accessed items
- **Optimistic Rendering:** Show UI immediately, correct if operation fails
- **Prefetching:** Load data before user requests it
- **JID (Job ID):** ChRIS plugin instance ID
- **Feed Tree:** DAG structure of ChRIS feeds and nodes
- **Stale Hit:** Cache hit where TTL has expired

### B. Configuration Reference

**File:** `~/.config/chell/config.json`

```json
{
  "cache": {
    "maxEntries": 100,
    "defaultTTL": 180000,
    "ttlConfig": {
      "/PUBLIC": 600000,
      "/home": 300000,
      "/bin": 3600000,
      "/feeds/*": 300000
    }
  },
  "jobs": {
    "pollInterval": 10000,
    "maxWatchedJobs": 50,
    "notifications": true
  },
  "ui": {
    "spinnerThreshold": 500,
    "dynamicPrompt": true,
    "showCacheAge": true
  }
}
```

### C. Performance Benchmarks

**Baseline (before implementation):**
```
ls /PUBLIC (first):      203ms
ls /PUBLIC (cached):     4ms
ls /PUBLIC (after cd):   201ms  ← Refetches!
cd /PUBLIC:              145ms
plugin run:              blocking for 2+ minutes
```

**Target (after implementation):**
```
ls /PUBLIC (first):      203ms  (unchanged)
ls /PUBLIC (cached):     4ms    (unchanged)
ls /PUBLIC (after cd):   4ms    ← Now cached!
cd /PUBLIC:              145ms  (unchanged, but prefetches in background)
plugin run:              < 500ms, returns immediately
```

### D. Migration Checklist

**Before deployment:**
- [ ] All tests pass (unit, integration, performance)
- [ ] Documentation updated
- [ ] Backward compatibility verified
- [ ] Performance benchmarks collected
- [ ] User testing completed

**During deployment:**
- [ ] Deploy cumin first (infrastructure)
- [ ] Deploy salsa (business logic)
- [ ] Deploy chili (controllers)
- [ ] Deploy chell (shell)
- [ ] Monitor error rates
- [ ] Monitor performance metrics

**After deployment:**
- [ ] Collect user feedback
- [ ] Monitor cache hit rates
- [ ] Monitor job polling load
- [ ] Tune TTL values based on real usage
- [ ] Document lessons learned

---

## Document Status

**Current Phase:** Planning (not started)

**Next Steps:**
1. Review and approve this plan
2. Set up performance monitoring infrastructure
3. Begin Phase 1: Enhanced Cache implementation
4. Weekly progress reviews

**Stakeholders:**
- chell development team
- ChRIS API team (for job management API clarification)
- Early adopters (for UX feedback)

**Review Schedule:**
- Weekly: Progress review
- End of each phase: Acceptance criteria validation
- End of project: Comprehensive performance audit

---

**End of Responsive Shell Plan**

*Last updated: 2025-12-02*
