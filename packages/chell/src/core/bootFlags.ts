/**
 * @file Pure derivation of chell boot flags from the parsed CLI config.
 *
 * Centralizes the interactive/prefetch/logo flag logic so it can be unit-tested
 * independently of the boot sequence. Dependency-free (type-only import).
 *
 * @module
 */
import type { ChellCLIConfig } from './cli.js';

/**
 * Resolved boot flags controlling interactivity, prefetching, and the splash.
 */
export interface BootFlags {
  isInteractiveSession: boolean;
  useAsciiBoot: boolean;
  prefetchPlugins: boolean;
  prefetchFeeds: boolean;
  prefetchPublicFeeds: boolean;
  prefetchJobs: boolean;
  showLogo: boolean;
}

/**
 * Computes the boot flags from the CLI config and TTY availability.
 *
 * Prefetch and logo flags are gated on an interactive session; ASCII boot is
 * forced when not attached to a TTY.
 *
 * @param config - The parsed CLI config.
 * @param isTTY - Whether stdout is a TTY.
 * @returns The resolved boot flags.
 */
export function bootFlags_compute(config: ChellCLIConfig, isTTY: boolean): BootFlags {
  const isInteractiveSession: boolean = config.mode !== 'execute' && config.mode !== 'script';
  const useAsciiBoot: boolean = (config.asciiBoot ?? false) || !isTTY;
  const prefetchFeeds: boolean = isInteractiveSession && (config.prefetchFeeds ?? true);
  return {
    isInteractiveSession,
    useAsciiBoot,
    prefetchPlugins: isInteractiveSession && (config.prefetchPlugins ?? true),
    prefetchFeeds,
    prefetchPublicFeeds: isInteractiveSession && prefetchFeeds && (config.prefetchPublicFeeds ?? true),
    prefetchJobs: isInteractiveSession && (config.prefetchJobs ?? true),
    showLogo: isInteractiveSession && isTTY && (config.showLogo ?? true),
  };
}
