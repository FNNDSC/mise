/**
 * @file Builtin du command.
 * Displays disk usage.
 */
import chalk from 'chalk';
import path from 'path';
import { ParsedArgs, commandArgs_process, path_resolve } from '../utils.js';
import { session } from '../../session/index.js';
import { vfs } from '../../lib/vfs/vfs.js';
import { spinner } from '../../lib/spinner.js';
import { scan_do, type CLIscan, type ScanRecord } from '@fnndsc/chili/path/pathCommand.js';
import { bytes_format } from '@fnndsc/chili/commands/fs/upload.js';

/**
 * Displays disk usage statistics for ChRIS filesystem directories.
 * Mimics standard Linux du command behavior and flags.
 * Uses chili's scan_do machinery for recursive filesystem traversal.
 *
 * @param args - Command line arguments (optional path and flags).
 * @returns A Promise that resolves when disk usage is displayed.
 *
 * @example
 * ```
 * du                      # Disk usage of current directory
 * du -h                   # Human-readable sizes
 * du -s /home/user/data   # Summary only
 * du -a                   # Show all files, not just directories
 * du -c                   # Show grand total
 * du -d 2                 # Max depth of 2 levels
 * ```
 */
export async function builtin_du(args: string[]): Promise<void> {
  const parsed: ParsedArgs = commandArgs_process(args);
  const pathArgs: string[] = parsed._ as string[];

  // Parse flags
  const humanReadable: boolean = !!parsed['h'] || !!parsed['human-readable'];
  const summarize: boolean = !!parsed['s'] || !!parsed['summarize'];
  const showAll: boolean = !!parsed['a'] || !!parsed['all'];
  const showTotal: boolean = !!parsed['c'] || !!parsed['total'];
  const separateDirs: boolean = !!parsed['S'] || !!parsed['separate-dirs'];
  const maxDepth: number | undefined = parsed['d'] ? parseInt(String(parsed['d']), 10) :
                                        parsed['max-depth'] ? parseInt(String(parsed['max-depth']), 10) : undefined;

  // Determine target paths
  const originalFolder: string = await session.getCWD();
  const rawTargets: string[] = pathArgs.length > 0 ? pathArgs : ['.'];
  
  // Pre-resolve all targets against the ORIGINAL working directory
  const resolvedTargets: string[] = [];
  for (const raw of rawTargets) {
    resolvedTargets.push(await path_resolve(raw));
  }

  let grandTotal: number = 0;

  // Format size for display with padding for alignment
  const size_format = (bytes: number): string => {
    let formatted: string;
    if (humanReadable) {
      formatted = bytes_format(bytes);
    } else {
      // KB (1024 bytes per block, like du default)
      formatted = Math.ceil(bytes / 1024).toString();
    }
    // Pad to 12 characters for alignment (matches typical sizes)
    return formatted.padStart(12, ' ');
  };

  try {
    for (const targetPath of resolvedTargets) {
      const argLabel = path.basename(targetPath); 
      spinner.start(`Scanning ${argLabel}...`);

      // Check if target is a file or directory
      let isDirectory = false;
      let fileSize = 0;

      try {
        // Use vfs to get metadata (directory: true asks for the item itself)
        const result = await vfs.data_get(targetPath, { directory: true });
        
        if (result.ok && result.value.length > 0) {
           const item = result.value[0];
           if (item.type === 'dir' || item.type === 'vfs') {
             isDirectory = true;
           } else {
             isDirectory = false;
             fileSize = item.size || 0;
           }
        } else {
           spinner.stop();
           console.error(chalk.red(`du: cannot access '${targetPath}': No such file or directory`));
           continue; 
        }
      } catch (e) {
         spinner.stop();
         console.error(chalk.red(`du: cannot access '${targetPath}': ${e}`));
         continue;
      }

      if (!isDirectory) {
         // It is a file
         grandTotal += fileSize;
         spinner.stop();
         console.log(`${size_format(fileSize)}	${targetPath}`);
         continue;
      }

      // It is a directory, use scan_do
      await session.setCWD(targetPath);
      
      // Build scan options
      const scanOptions: CLIscan = {
        silent: true,
        tree: false,
        follow: false,
        dirsOnly: false,
      };
      
      const scanResult: ScanRecord | null = await scan_do(scanOptions);

      // Restore CWD immediately after scan
      await session.setCWD(originalFolder);

      if (!scanResult) {
        spinner.stop();
        // Suppress duplicate error if scan_do printed one
        continue;
      }

      // Aggregate sizes for this target
      const dirSizes: Map<string, number> = new Map<string, number>();
      
      scanResult.fileInfo.forEach((fileInfo: any) => {
        const filePath: string = fileInfo.chrisPath;
        const fSize: number = fileInfo.size;

        if (fileInfo.isDirectory) {
          if (!dirSizes.has(filePath)) {
            dirSizes.set(filePath, 0);
          }
        } else {
          // File: add to its parent directory and all ancestor directories
          // BUT only up to the targetPath we are currently scanning
          let currentPath: string = path.posix.dirname(filePath);

          while (currentPath && currentPath.startsWith(targetPath)) {
             const currentSize: number = dirSizes.get(currentPath) || 0;
             dirSizes.set(currentPath, currentSize + fSize);
             
             if (currentPath === targetPath) break; 
             if (separateDirs) break;
             currentPath = path.posix.dirname(currentPath);
          }
          
          // If -a is set, show files
          if (showAll) {
             dirSizes.set(filePath, fSize);
          }
        }
      });
      
      // Ensure the target directory itself exists in map with total size
      if (!dirSizes.has(targetPath)) {
         dirSizes.set(targetPath, scanResult.totalSize);
      }
      
      grandTotal += scanResult.totalSize;
      spinner.stop();

      // Stream output for this target
      if (summarize) {
         const size: number = dirSizes.get(targetPath) || 0;
         console.log(`${size_format(size)}	${targetPath}`);
      } else {
         // Sort entries for this target
         let entries: Array<[string, number]> = Array.from(dirSizes.entries());
         entries.sort((a, b) => a[0].localeCompare(b[0]));

         for (const [dirPath, dirSize] of entries) {
            // Max-depth check
            if (maxDepth !== undefined) {
               const rel = path.posix.relative(targetPath, dirPath);
               const depth = rel === '' ? 0 : rel.split('/').length;
               if (depth > maxDepth) continue;
            }
            console.log(`${size_format(dirSize)}	${dirPath}`);
         }
      }
    } // end for targets

    if (showTotal && rawTargets.length > 0) {
       console.log(`${size_format(grandTotal)}	total`);
    }

  } finally {
    spinner.stop();
    // Restore original path
    await session.setCWD(originalFolder);
  }
}
