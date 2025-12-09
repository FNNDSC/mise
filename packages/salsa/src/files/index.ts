import * as path from 'path';
import {
  ChRISEmbeddedResourceGroup,
  objContext_create,
  chrisContext,
  Context,
  errorStack,
  chrisIO,
  chrisConnection,
  ListOptions, 
  FilteredResourceData,
  Result,
  Ok,
  Err,
} from "@fnndsc/cumin";
import Client, { FileBrowserFolder } from "@fnndsc/chrisapi";
import { fileContent_getPipeline } from './pipeline_content';
import { fileContent_getRegular } from './regular_content';
import { fileContent_getPACS } from './pacs_content';

/**
 * Represents a file or directory item in a recursive listing.
 */
export interface FsItem {
  path: string;
  type: 'file' | 'dir';
  size?: number;
}

/**
 * Recursively lists all files and directories under a given ChRIS path.
 *
 * @param rootPath - The starting directory path.
 * @returns A Promise resolving to an array of FsItem objects.
 */
export async function files_listRecursive(rootPath: string): Promise<FsItem[]> {
  let items: FsItem[] = [];

  // 1. List files in current directory
  const filesGroup = await files_getGroup('files', rootPath);
  if (filesGroup) {
    const fileResults: FilteredResourceData | null = await filesGroup.asset.resources_getAll();
    if (fileResults && fileResults.tableData) {
      fileResults.tableData.forEach((f: Record<string, any>) => {
        items.push({
          path: f.fname || '', // fname is the full path
          type: 'file',
          size: f.fsize || 0
        });
      });
    }
  }

  // 2. List subdirectories
  const dirsGroup = await files_getGroup('dirs', rootPath);
  if (dirsGroup) {
    const dirResults: FilteredResourceData | null = await dirsGroup.asset.resources_getAll();
    if (dirResults && dirResults.tableData) {
      for (const d of dirResults.tableData) {
        const dirPath: string = d.path;
        // Add the directory itself
        items.push({ path: dirPath, type: 'dir' });
        
        // Recurse
        const subItems: FsItem[] = await files_listRecursive(dirPath);
        items = items.concat(subItems);
      }
    }
  }

  return items;
}

/**
 * Recursively copies a directory from source to destination within ChRIS.
 *
 * @param srcPath - The source directory path.
 * @param destPath - The destination directory path (the parent + new dir name).
 * @returns A Promise resolving to true on success, false on failure.
 */
export async function files_copyRecursively(srcPath: string, destPath: string): Promise<boolean> {
  try {
    // Ensure destination directory exists (mkdir -p behavior ideally, but files_mkdir is shallow?)
    // Actually files_mkdir assumes parent exists.
    // For a copy, we create the target root first.
    await files_mkdir(destPath);

    const items: FsItem[] = await files_listRecursive(srcPath);
    let successCount = 0;
    let failCount = 0;

    for (const item of items) {
      // Normalize item.path to ensure it has a leading slash
      const normalizedItemPath: string = item.path.startsWith('/') ? item.path : '/' + item.path;

      const relativePath: string = normalizedItemPath.substring(srcPath.length).replace(/^\//, '');
      const targetPath: string = path.posix.join(destPath, relativePath); // Use posix for ChRIS paths

      if (item.type === 'dir') {
        console.log(`  Creating directory: ${targetPath}`);
        const created: boolean = await files_mkdir(targetPath);
        if (!created) {
          console.warn(`  Warning: Failed to create directory ${targetPath}`);
          failCount++;
        } else {
          successCount++;
        }
      } else if (item.type === 'file') {
        console.log(`  Copying file: ${path.posix.basename(normalizedItemPath)}`);
        const copied: boolean = await files_copy(normalizedItemPath, targetPath);
        if (!copied) {
          console.warn(`  Warning: Failed to copy file ${normalizedItemPath}`);
          failCount++;
          // Continue trying to copy other files instead of aborting
        } else {
          successCount++;
        }
      }
    }

    console.log(`Copied ${successCount} items, ${failCount} failed`);
    return failCount === 0;
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    errorStack.stack_push("error", `Recursive copy failed: ${msg}`);
    return false;
  }
}

/**
 * Resolves a file ID from a ChRIS path.
 *
 * @param srcPath - The absolute ChRIS file path.
 * @returns Result containing the file ID or Err on failure.
 */
async function fileId_resolve(srcPath: string): Promise<Result<number>> {
  const srcDir: string = path.posix.dirname(srcPath);
  const srcName: string = path.posix.basename(srcPath);

  const group: ChRISEmbeddedResourceGroup<FileBrowserFolder> | null = await files_getGroup('files', srcDir);
  if (!group) {
      errorStack.stack_push("error", `Could not access source directory: ${srcDir}`);
      return Err<number>();
  }

  const results: FilteredResourceData | null = await group.asset.resources_getAll();

  let fileId: number | undefined;
  if (results && results.tableData) {
      const match: { id?: number, fname?: string } | undefined = results.tableData.find((f: { fname?: string }) => {
          const fname: string = f.fname || '';
          return fname === srcPath || path.posix.basename(fname) === srcName;
      });
      if (match && match.id !== undefined) {
          fileId = Number(match.id);
      }
  }

  if (fileId === undefined) {
      errorStack.stack_push("error", `Source file not found: ${srcPath}`);
      return Err<number>();
  }

  return Ok(fileId);
}

/**
 * Determines whether a given ChRIS path refers to a directory.
 *
 * @param targetPath - The absolute ChRIS path to check.
 * @returns Promise resolving to true if the path is a directory, false otherwise.
 */
async function path_isDir(targetPath: string): Promise<boolean> {
  const parent: string = path.posix.dirname(targetPath);
  const name: string = path.posix.basename(targetPath);
  const results: FilteredResourceData | null = await files_listAll({ limit: 1000, offset: 0 }, "dirs", parent);

  if (!results || !results.tableData) {
    return false;
  }

  return results.tableData.some((entry: { path?: string, fname?: string }) => {
    const candidate: string = entry.path || entry.fname || "";
    return candidate === targetPath || path.posix.basename(candidate) === name;
  });
}

/**
 * Uploads content to a specified ChRIS path, effectively creating or overwriting a file.
 *
 * @param content - The content to upload (string, Buffer, or Blob).
 * @param pathStr - The ChRIS path for the new file.
 * @returns A Promise resolving to true on success, false on failure.
 */
export async function files_create(content: string | Buffer | Blob, pathStr: string): Promise<boolean> {
  try {
    let uploadContent: Blob;
    if (typeof content === 'string') {
      uploadContent = new Blob([content]);
    } else if (Buffer.isBuffer(content)) {
      uploadContent = new Blob([new Uint8Array(content)]); // Convert Buffer to Uint8Array for Blob
    } else {
      uploadContent = content; // Assume it's already a Blob
    }
    
    // Split path into directory and filename
    const dir = path.posix.dirname(pathStr);
    const name = path.posix.basename(pathStr);
    
    const success: boolean = await chrisIO.file_upload(uploadContent, dir, name);
    if (!success) {
      errorStack.stack_push("error", `File upload failed for ${pathStr}.`);
    }
    return success;
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    errorStack.stack_push("error", `File creation failed for ${pathStr}: ${msg}`);
    return false;
  }
}

/**
 * Creates a new empty file at the specified path (like Unix touch).
 * Optionally creates the file with specified content.
 *
 * @param path - The ChRIS path for the new file.
 * @param content - Optional content to write to the file (string, Buffer, or Blob).
 * @returns A Promise resolving to true on success, false on failure.
 */
export async function files_touch(
  path: string,
  content?: string | Buffer | Blob
): Promise<boolean> {
  // Use files_create with provided content or empty Blob
  const fileContent: string | Buffer | Blob = content ?? new Blob([""]);
  return await files_create(fileContent, path);
}

/**
 * Copies a single file from one ChRIS path to another.
 *
 * @param srcPath - The full path to the source file.
 * @param destPath - The full path to the destination file (including filename).
 * @returns A Promise resolving to true on success, false on failure.
 */
export async function files_copy(srcPath: string, destPath: string): Promise<boolean> {
  try {
    // 1. Resolve source file to get ID (needed for download)
    const fileIdResult: Result<number> = await fileId_resolve(srcPath);
    if (!fileIdResult.ok) {
      return false;
    }
    const fileId: number = fileIdResult.value;

    // 2. Download content
    const content: Buffer | null = await chrisIO.file_download(fileId);
    if (content === null) {
        errorStack.stack_push("error", `Failed to download source file (ID: ${fileId}): ${srcPath}`);
        return false;
    }

    // 3. Upload to destination
    // files_create handles Blob/Buffer conversion and path splitting
    const uploadSuccess: boolean = await files_create(content, destPath);
    if (!uploadSuccess) {
        const lastError = errorStack.stack_pop();
        if (lastError) {
            console.error(`    Error: ${lastError.message}`);
        }
    }
    return uploadSuccess;

  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    errorStack.stack_push("error", `Copy failed from ${srcPath} to ${destPath}: ${msg}`);
    return false;
  }
}

/**
 * Moves a file or directory by updating its path on the server.
 *
 * For directories, this performs a server-side rename without data transfer.
 * For files, the file ID is resolved and the path is updated.
 *
 * @param srcPath - The source file or directory path.
 * @param destPath - The target path. If an existing directory or trailing slash is provided,
 *                   the source basename is appended.
 * @returns Promise resolving to true on success, false on failure.
 */
export async function files_move(srcPath: string, destPath: string): Promise<boolean> {
  try {
    const srcIsDir: boolean = await path_isDir(srcPath);
    const destIsDir: boolean = await path_isDir(destPath);
    const destLooksDir: boolean = destPath.endsWith("/");
    const finalDest: string = (destIsDir || destLooksDir)
      ? path.posix.join(destPath, path.posix.basename(srcPath))
      : destPath;

    if (srcIsDir) {
      const moveResult: Result<boolean> = await chrisIO.folder_moveByPath(srcPath, finalDest);
      return moveResult.ok && moveResult.value;
    }

    const fileIdResult: Result<number> = await fileId_resolve(srcPath);
    if (!fileIdResult.ok) {
      return false;
    }

    const moveResult: Result<boolean> = await chrisIO.file_moveById(fileIdResult.value, finalDest);
    return moveResult.ok && moveResult.value;
  } catch (error: unknown) {
    const msg: string = error instanceof Error ? error.message : String(error);
    errorStack.stack_push("error", `Move failed from ${srcPath} to ${destPath}: ${msg}`);
    return false;
  }
}

/**
 * Uploads a local file or directory to ChRIS recursively.
 *
 * @param localPath - The local filesystem path.
 * @param remotePath - The ChRIS destination path.
 * @returns Promise<boolean> success.
 */
export async function files_uploadPath(localPath: string, remotePath: string): Promise<boolean> {
  return await chrisIO.uploadLocalPath(localPath, remotePath);
}

/**
 * Creates a new folder (directory) at the specified ChRIS path.
 *
 * @param folderPath - The full ChRIS path for the new folder.
 * @returns A Promise resolving to true on success, false on failure.
 */
export async function files_mkdir(folderPath: string): Promise<boolean> {
  try {
    const client: Client | null = await chrisConnection.client_get();
    if (!client) {
      errorStack.stack_push("error", "Not connected to ChRIS. Cannot create folder.");
      return false;
    }

    // Get the FileBrowserFolderList resource
    const folderList = await client.getFileBrowserFolders();

    // Use the post method to create the new folder
    const response = await folderList.post({ path: folderPath });

    if (response && response.data) {
      return true; // Folder created successfully
    } else {
      errorStack.stack_push("error", `Failed to create folder: ${folderPath}. No data in response.`);
      return false;
    }
  } catch (error: unknown) {
    // Type guard for axios error with response
    if (
      error &&
      typeof error === 'object' &&
      'response' in error &&
      error.response &&
      typeof error.response === 'object' &&
      'status' in error.response &&
      error.response.status === 400 &&
      'data' in error.response &&
      error.response.data &&
      typeof error.response.data === 'object' &&
      'path' in error.response.data &&
      Array.isArray(error.response.data.path) &&
      error.response.data.path[0] &&
      typeof error.response.data.path[0] === 'string' &&
      error.response.data.path[0].includes('already exists')
    ) {
      errorStack.stack_push("warning", `Folder '${folderPath}' already exists.`);
      return true; // Consider it a success if it already exists
    }
    const errorMessage: string = error instanceof Error ? error.message : String(error);
    errorStack.stack_push("error", `Error creating folder '${folderPath}': ${errorMessage}`);
    return false;
  }
}


/**
 * Interface for file sharing options.
 */
export interface FileShareOptions {
  is_public?: boolean;
  // Define options for sharing files
  // e.g., userId: number, permission: 'read' | 'write'
  [key: string]: unknown;
}

/**
 * Creates a ChRISEmbeddedResourceGroup for a specific asset type (files, links, dirs).
 * This function encapsulates the logic from `FileController.handler_create`.
 *
 * @param assetName - The type of asset ('files', 'links', 'dirs').
 * @param path - Optional ChRIS path. Defaults to current folder context.
 * @returns A Promise resolving to a ChRISEmbeddedResourceGroup instance, or null on error.
 */
export async function files_getGroup(
  assetName: string,
  path?: string
): Promise<ChRISEmbeddedResourceGroup<FileBrowserFolder> | null> {
  if (!path) {
    const fileContext: string | null = await chrisContext.current_get(
      Context.ChRISfolder
    );
    path = fileContext ? fileContext : "/";
  }

  let chrisFileSystemGroup: ChRISEmbeddedResourceGroup<FileBrowserFolder> | null = null;

  try {
    switch (assetName) {
      case "files":
        chrisFileSystemGroup = (await objContext_create(
          "ChRISFilesContext",
          `folder:${path}`
        )) as ChRISEmbeddedResourceGroup<FileBrowserFolder>;
        break;
      case "links":
        chrisFileSystemGroup = (await objContext_create(
          "ChRISLinksContext",
          `folder:${path}`
        )) as ChRISEmbeddedResourceGroup<FileBrowserFolder>;
        break;
      case "dirs":
        chrisFileSystemGroup = (await objContext_create(
          "ChRISDirsContext",
          `folder:${path}`
        )) as ChRISEmbeddedResourceGroup<FileBrowserFolder>;
        break;
      default:
        errorStack.stack_push("error", `Unsupported asset type: ${assetName}`);
        return null;
    }

    if (!chrisFileSystemGroup) {
      errorStack.stack_push("error", `Failed to initialize ChRIS context for ${assetName} at ${path}`);
      return null;
    }
  } catch (error) {
    errorStack.stack_push("error", `Error creating ChRISEmbeddedResourceGroup for ${assetName}: ${error}`);
    return null;
  }

  return chrisFileSystemGroup;
}

/**
 * List files, links, or directories based on options.
 *
 * @param options - Search and pagination options.
 * @param assetName - The type of asset to list ('files', 'links', 'dirs').
 * @param path - Optional ChRIS path. Defaults to current folder context.
 * @returns A Promise resolving to FilteredResourceData or null.
 */
export async function files_list(options: ListOptions, assetName: string = "files", path?: string): Promise<FilteredResourceData | null> {
  const group = await files_getGroup(assetName, path);
  if (!group) {
    return null;
  }
  return await group.asset.resources_listAndFilterByOptions(options);
}

/**
 * List *all* files, links, or directories by automatically handling pagination.
 *
 * @param options - Search options (limit and offset will be managed internally).
 * @param assetName - The type of asset to list ('files', 'links', 'dirs').
 * @param path - Optional ChRIS path. Defaults to current folder context.
 * @returns A Promise resolving to FilteredResourceData containing all matching assets, or null.
 */
export async function files_listAll(options: ListOptions, assetName: string = "files", path?: string): Promise<FilteredResourceData | null> {
  const group = await files_getGroup(assetName, path);
  if (!group) {
    return null;
  }
  return await group.asset.resources_getAll(options);
}

/**
 * Get the list of available fields for files, links, or directories.
 *
 * @param assetName - The type of asset ('files', 'links', 'dirs').
 * @returns A Promise resolving to an array of field names or null.
 */
export async function fileFields_get(assetName: string = "files"): Promise<string[] | null> {
  const group = await files_getGroup(assetName);
  if (!group) {
    return null;
  }
  const results = await group.asset.resourceFields_get();
  return results ? results.fields : null;
}

/**
 * Deletes a file, link, or directory by its ID.
 *
 * @param id - The ID of the asset to delete.
 * @param assetName - The type of asset ('files', 'links', 'dirs').
 * @returns A Promise resolving to true on success, false on failure.
 */
export async function files_delete(id: number, assetName: string = "files"): Promise<boolean> {
  const group = await files_getGroup(assetName);
  if (!group) {
    return false;
  }
  return await group.asset.resourceItem_delete(id);
}

/**
 * Creates a ChRISEmbeddedResourceGroup for a single file.
 * This function encapsulates the logic from `FileController.member_create`.
 *
 * @param path - The ChRIS path to the file.
 * @returns A Promise resolving to a ChRISEmbeddedResourceGroup instance, or null on error.
 */
export async function files_getSingle(
  path: string
): Promise<ChRISEmbeddedResourceGroup<FileBrowserFolder> | null> {
  let chrisFilesGroup: ChRISEmbeddedResourceGroup<FileBrowserFolder> | null = null;
  try {
    chrisFilesGroup = (await objContext_create(
      "ChRISFilesContext",
      `folder:${path}`
    )) as ChRISEmbeddedResourceGroup<FileBrowserFolder>;

    if (!chrisFilesGroup) {
      errorStack.stack_push("error", `Failed to create ChRISFilesContext for path: ${path}`);
      return null;
    }
  } catch (error) {
    errorStack.stack_push("error", `Error creating ChRISFilesContext for path ${path}: ${error}`);
    return null;
  }
  return chrisFilesGroup;
}


/**
 * Shares files in ChRIS.
 *
 * @param fileId - The ID of the file to share.
 * @param options - Options for sharing (e.g., user, permissions).
 * @returns A Promise resolving to true.
 */
export async function files_share(fileId: number, options: FileShareOptions): Promise<boolean> {
  // Implement actual sharing logic using cumin/chrisapi
  console.log(`Sharing file ${fileId} with options:`, options);
  return Promise.resolve(true);
}

/**
 * Retrieves the content of a file by its path.
 *
 * Router function that delegates to specialized handlers based on path type.
 *
 * @param filePath - The full ChRIS path to the file.
 * @returns A Result containing the content string or error.
 */
export async function fileContent_get(filePath: string): Promise<Result<string>> {
  if (filePath.startsWith('/PIPELINES/')) {
    return fileContent_getPipeline(filePath);
  }
  if (filePath.startsWith('/SERVICES/PACS/')) {
    return fileContent_getPACS(filePath);
  }
  return fileContent_getRegular(filePath);
}