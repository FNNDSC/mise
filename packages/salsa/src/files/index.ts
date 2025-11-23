import {
  ChRISEmbeddedResourceGroup,
  objContext_create,
  chrisContext,
  Context,
  errorStack,
  chrisIO,
  chrisConnection,
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
  // Define options for sharing files
  // e.g., userId: number, permission: 'read' | 'write'
  [key: string]: any;
}

/**
 * Interface for file viewing options.
 */
export interface FileViewOptions {
  // Define options for viewing files
  // e.g., format: 'text' | 'json' | 'raw'
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
 * @returns A Promise resolving to void.
 */
export async function files_share(fileId: number, options: FileShareOptions): Promise<void> {
  // Implement actual sharing logic using cumin/chrisapi
  console.log(`Sharing file ${fileId} with options:`, options);
  return Promise.resolve();
}

/**
 * Views content of a file in ChRIS.
 *
 * @param fileId - The ID of the file to view.
 * @param options - Options for viewing (e.g., format).
 * @returns A Promise resolving to the file content (e.g., string, Buffer, or URL).
 */
export async function files_view(fileId: number, options: FileViewOptions): Promise<any> {
  // Implement actual file viewing logic using cumin/chrisapi
  console.log(`Viewing file ${fileId} with options:`, options);
  return Promise.resolve(`Content of file ${fileId}`);
}