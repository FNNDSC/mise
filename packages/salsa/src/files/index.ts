import * as path from 'path';
import {
  ChRISEmbeddedResourceGroup,
  objContext_create,
  chrisContext,
  Context,
  errorStack,
  chrisIO,
  chrisConnection,
  ListOptions, // Added
  FilteredResourceData, // Added
} from "@fnndsc/cumin";
import { FileBrowserFolder } from "@fnndsc/chrisapi"; // From chrisapi, not cumin

// ... existing interfaces ...

/**
 * Uploads content to a specified ChRIS path, effectively creating or overwriting a file.
 *
 * @param content - The content to upload (string, Buffer, or Blob).
 * @param path - The ChRIS path for the new file.
 * @returns A Promise resolving to true on success, false on failure.
 */
export async function files_create(content: string | Buffer | Blob, path: string): Promise<boolean> {
  try {
    let uploadContent: Blob;
    if (typeof content === 'string') {
      uploadContent = new Blob([content]);
    } else if (Buffer.isBuffer(content)) {
      uploadContent = new Blob([new Uint8Array(content)]); // Convert Buffer to Uint8Array for Blob
    } else {
      uploadContent = content; // Assume it's already a Blob
    }
    const success = await chrisIO.file_upload(uploadContent, path);
    if (!success) {
      errorStack.stack_push("error", `File upload failed for ${path}.`);
    }
    return success;
  } catch (error) {
    errorStack.stack_push("error", `File creation failed for ${path}: ${error}`);
    return false;
  }
}

/**
 * Creates a new empty file at the specified path (like Unix touch).
 *
 * @param path - The ChRIS path for the new file.
 * @returns A Promise resolving to true on success, false on failure.
 */
export async function files_touch(path: string): Promise<boolean> {
  // Use files_create with an empty Blob
  return await files_create(new Blob([""]), path);
}

/**
 * Creates a new folder (directory) at the specified ChRIS path.
 *
 * @param folderPath - The full ChRIS path for the new folder.
 * @returns A Promise resolving to true on success, false on failure.
 */
export async function files_mkdir(folderPath: string): Promise<boolean> {
  try {
    const client = await chrisConnection.client_get();
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
  } catch (error: any) {
    if (error.response && error.response.status === 400 && error.response.data.path && error.response.data.path[0].includes('already exists')) {
      errorStack.stack_push("warning", `Folder '${folderPath}' already exists.`);
      return true; // Consider it a success if it already exists
    }
    errorStack.stack_push("error", `Error creating folder '${folderPath}': ${error.message}`);
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
  [key: string]: any;
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
 * Views content of a file in ChRIS.
 *
 * @param fileId - The ID of the file to view.
 * @returns A Promise resolving to the file content as a Buffer, or null on failure.
 */
export async function files_view(fileId: number): Promise<Buffer | null> {
  return await chrisIO.file_download(fileId);
}

/**
 * Retrieves the content of a file by its path.
 *
 * @param filePath - The full ChRIS path to the file.
 * @returns A Promise resolving to the content string or null.
 */
export async function files_content(filePath: string): Promise<string | null> {
  const dir = path.dirname(filePath);
  const name = path.basename(filePath);
  
  const group = await files_getGroup('files', dir);
  if (!group) return null;
  
  const results = await group.asset.resources_getAll();
  if (results && results.tableData) {
     const file = results.tableData.find((f: any) => {
         const fname = f.fname || '';
         // Compare basenames to find the file in this directory
         return path.basename(fname) === name;
     });
     
     if (file && file.id) {
         const buffer = await files_view(Number(file.id));
         return buffer ? buffer.toString('utf-8') : null;
     }
  }
  return null;
}
