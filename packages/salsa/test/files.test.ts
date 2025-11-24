import {
  files_getGroup,
  files_getSingle,
  files_share,
  files_view,
  files_mkdir,
  files_create, // Import the new function
  files_touch, // Re-import to test its new implementation
  FileShareOptions
} from '../src/files/index';
import {
  objContext_create,
  chrisContext,
  Context,
  errorStack,
  ChRISEmbeddedResourceGroup,
  chrisConnection,
  chrisIO // Import chrisIO
} from '@fnndsc/cumin';
import { FileBrowserFolder } from '@fnndsc/chrisapi';

jest.mock('@fnndsc/cumin', () => {
  return {
    chrisConnection: {
      client_get: jest.fn()
    },
    chrisIO: {
      file_upload: jest.fn(),
      file_download: jest.fn()
    },
    chrisContext: {
      current_get: jest.fn()
    },
    objContext_create: jest.fn(),
    errorStack: {
      stack_push: jest.fn()
    },
    Context: {
      ChRISfolder: 'folder'
    }
  };
});
jest.mock('@fnndsc/chrisapi');

describe('files', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // Mock chrisContext.current_get to return a default path
    (chrisContext.current_get as jest.Mock).mockResolvedValue('/default/chris/folder');
    // Mock objContext_create to return a mock ChRISEmbeddedResourceGroup
    (objContext_create as jest.Mock).mockImplementation((contextName: string, folder: string) => {
      // Return a simple mock object that matches the expected type structure enough to pass checks
      return Promise.resolve({
        contextName,
        folder,
        asset: {
            // Mock asset properties if needed for deeper testing
        }
      } as unknown as ChRISEmbeddedResourceGroup<FileBrowserFolder>);
    });
    // Mock errorStack
    (errorStack.stack_push as jest.Mock).mockImplementation(jest.fn());
    // Mock chrisConnection.client_get for files_mkdir
    (chrisConnection.client_get as jest.Mock).mockResolvedValue({
      getFileBrowserFolders: jest.fn().mockResolvedValue({
        post: jest.fn().mockResolvedValue({ data: { path: '/new/folder' } })
      })
    });
    // Mock chrisIO.file_upload for files_create and files_touch
    (chrisIO.file_upload as jest.Mock).mockResolvedValue(true);
    // Mock chrisIO.file_download for files_view
    (chrisIO.file_download as jest.Mock).mockResolvedValue(Buffer.from('Content of file 456'));
  });

  // ... (existing tests for getGroup, getSingle, mkdir, create, touch)

  describe('files_getGroup', () => {
    it('should create a files group with default context if path is not provided', async () => {
      const result = await files_getGroup('files');
      expect(chrisContext.current_get).toHaveBeenCalledWith(Context.ChRISfolder);
      expect(objContext_create).toHaveBeenCalledWith('ChRISFilesContext', 'folder:/default/chris/folder');
      expect(result).toBeDefined();
      expect(errorStack.stack_push).not.toHaveBeenCalled();
    });

    it('should create a links group with provided path', async () => {
      const result = await files_getGroup('links', '/custom/path');
      expect(chrisContext.current_get).not.toHaveBeenCalled();
      expect(objContext_create).toHaveBeenCalledWith('ChRISLinksContext', 'folder:/custom/path');
      expect(result).toBeDefined();
      expect(errorStack.stack_push).not.toHaveBeenCalled();
    });

    it('should create a dirs group with root path if context is null', async () => {
      (chrisContext.current_get as jest.Mock).mockResolvedValue(null);
      const result = await files_getGroup('dirs');
      expect(chrisContext.current_get).toHaveBeenCalledWith(Context.ChRISfolder);
      expect(objContext_create).toHaveBeenCalledWith('ChRISDirsContext', 'folder:/');
      expect(result).toBeDefined();
      expect(errorStack.stack_push).not.toHaveBeenCalled();
    });

    it('should return null and push error for unsupported asset type', async () => {
      const result = await files_getGroup('unsupported');
      expect(result).toBeNull();
      expect(errorStack.stack_push).toHaveBeenCalledWith('error', 'Unsupported asset type: unsupported');
    });

    it('should return null and push error if objContext_create fails', async () => {
        (objContext_create as jest.Mock).mockResolvedValue(null);
        const result = await files_getGroup('files');
        expect(result).toBeNull();
        expect(errorStack.stack_push).toHaveBeenCalledWith('error', expect.stringContaining('Failed to initialize ChRIS context'));
    });

    it('should return null and push error if objContext_create throws an exception', async () => {
        (objContext_create as jest.Mock).mockRejectedValue(new Error('Test objContext_create failure'));
        const result = await files_getGroup('files');
        expect(result).toBeNull();
        expect(errorStack.stack_push).toHaveBeenCalledWith('error', expect.stringContaining('Error creating ChRISEmbeddedResourceGroup for files: Error: Test objContext_create failure'));
    });
  });

  describe('files_getSingle', () => {
    it('should create a single file group with provided path', async () => {
      const result = await files_getSingle('/single/file.txt');
      expect(objContext_create).toHaveBeenCalledWith('ChRISFilesContext', 'folder:/single/file.txt');
      expect(result).toBeDefined();
      expect(errorStack.stack_push).not.toHaveBeenCalled();
    });

    it('should return null and push error if objContext_create fails', async () => {
        (objContext_create as jest.Mock).mockResolvedValue(null);
        const result = await files_getSingle('/single/file.txt');
        expect(result).toBeNull();
        expect(errorStack.stack_push).toHaveBeenCalledWith('error', expect.stringContaining('Failed to create ChRISFilesContext'));
    });

    it('should return null and push error if objContext_create throws an exception', async () => {
        (objContext_create as jest.Mock).mockRejectedValue(new Error('Test objContext_create failure'));
        const result = await files_getSingle('/single/file.txt');
        expect(result).toBeNull();
        expect(errorStack.stack_push).toHaveBeenCalledWith('error', expect.stringContaining('Error creating ChRISFilesContext for path /single/file.txt: Error: Test objContext_create failure'));
    });
  });

  describe('files_mkdir', () => {
    it('should successfully create a new folder', async () => {
      const mockPost = jest.fn().mockResolvedValue({ data: { path: '/test/folder' } });
      const mockGetFileBrowserFolders = jest.fn().mockResolvedValue({ post: mockPost });
      (chrisConnection.client_get as jest.Mock).mockResolvedValue({
        getFileBrowserFolders: mockGetFileBrowserFolders
      });

      const folderPath = '/test/folder';
      const result = await files_mkdir(folderPath);

      expect(chrisConnection.client_get).toHaveBeenCalled();
      expect(mockGetFileBrowserFolders).toHaveBeenCalled();
      expect(mockPost).toHaveBeenCalledWith({ path: folderPath });
      expect(result).toBe(true);
      expect(errorStack.stack_push).not.toHaveBeenCalled();
    });

    it('should return false and push error if not connected to ChRIS', async () => {
      (chrisConnection.client_get as jest.Mock).mockResolvedValue(null);
      const result = await files_mkdir('/test/folder');
      expect(result).toBe(false);
      expect(errorStack.stack_push).toHaveBeenCalledWith('error', 'Not connected to ChRIS. Cannot create folder.');
    });

    it('should return true and push warning if folder already exists', async () => {
      const mockPost = jest.fn().mockRejectedValue({
        response: {
          status: 400,
          data: { path: ['Folder with this path already exists.'] }
        }
      });
      const mockGetFileBrowserFolders = jest.fn().mockResolvedValue({ post: mockPost });
      (chrisConnection.client_get as jest.Mock).mockResolvedValue({
        getFileBrowserFolders: mockGetFileBrowserFolders
      });

      const folderPath = '/existing/folder';
      const result = await files_mkdir(folderPath);
      expect(result).toBe(true); // Should return true as it's not a real failure
      expect(errorStack.stack_push).toHaveBeenCalledWith('warning', `Folder '${folderPath}' already exists.`);
    });

    it('should return false and push error for other API errors', async () => {
      const mockPost = jest.fn().mockRejectedValue(new Error('API error'));
      const mockGetFileBrowserFolders = jest.fn().mockResolvedValue({ post: mockPost });
      (chrisConnection.client_get as jest.Mock).mockResolvedValue({
        getFileBrowserFolders: mockGetFileBrowserFolders
      });

      const folderPath = '/error/folder';
      const result = await files_mkdir(folderPath);
      expect(result).toBe(false);
      expect(errorStack.stack_push).toHaveBeenCalledWith('error', `Error creating folder '${folderPath}': API error`);
    });
  });

  describe('files_create', () => {
    it('should successfully create a file with string content', async () => {
      const path = '/new/file.txt';
      const content = 'hello world';
      const result = await files_create(content, path);

      expect(chrisIO.file_upload).toHaveBeenCalledWith(expect.any(Blob), path);
      // Verify Blob content (jest doesn't easily let us inspect Blob content directly for expect)
      // We can rely on file_upload's mock for now.
      expect(result).toBe(true);
      expect(errorStack.stack_push).not.toHaveBeenCalled();
    });

    it('should successfully create a file with Buffer content', async () => {
      const path = '/new/buffer_file.bin';
      const content = Buffer.from([0x01, 0x02, 0x03]);
      const result = await files_create(content, path);

      expect(chrisIO.file_upload).toHaveBeenCalledWith(expect.any(Blob), path);
      expect(result).toBe(true);
      expect(errorStack.stack_push).not.toHaveBeenCalled();
    });

    it('should successfully create a file with Blob content', async () => {
      const path = '/new/blob_file.dat';
      const content = new Blob(['blob data']);
      const result = await files_create(content, path);

      expect(chrisIO.file_upload).toHaveBeenCalledWith(content, path);
      expect(result).toBe(true);
      expect(errorStack.stack_push).not.toHaveBeenCalled();
    });

    it('should return false and push error if file_upload fails', async () => {
      (chrisIO.file_upload as jest.Mock).mockResolvedValue(false); // Simulate upload failure
      const path = '/fail.txt';
      const result = await files_create('fail content', path);
      expect(result).toBe(false);
      expect(errorStack.stack_push).toHaveBeenCalledWith('error', `File upload failed for ${path}.`);
    });

    it('should return false and push error if file_upload throws an exception', async () => {
      (chrisIO.file_upload as jest.Mock).mockRejectedValue(new Error('Upload error'));
      const result = await files_create('exception content', '/exception.txt');
      expect(result).toBe(false);
      expect(errorStack.stack_push).toHaveBeenCalledWith('error', expect.stringContaining('File creation failed for /exception.txt: Error: Upload error'));
    });
  });

  describe('files_touch', () => {
    it('should create an empty file by calling files_create with an empty blob', async () => {
      const path = '/empty.txt';
      const result = await files_touch(path);

      expect(chrisIO.file_upload).toHaveBeenCalledWith(expect.any(Blob), path);
      // Can't directly check Blob content here, but we know it should be empty based on implementation
      expect(result).toBe(true);
      expect(errorStack.stack_push).not.toHaveBeenCalled();
    });

    it('should return false if files_create fails for touch', async () => {
      (chrisIO.file_upload as jest.Mock).mockResolvedValue(false);
      const path = '/fail_touch.txt';
      const result = await files_touch(path);
      expect(result).toBe(false);
      // Now, only the error from files_create should be pushed
      expect(errorStack.stack_push).toHaveBeenCalledWith('error', `File upload failed for ${path}.`);
    });
  });

  describe('files_share', () => {
    it('should log sharing info and resolve', async () => {
      const consoleSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
      const options: FileShareOptions = { is_public: true };
      await files_share(123, options);
      expect(consoleSpy).toHaveBeenCalledWith('Sharing file 123 with options:', options);
      consoleSpy.mockRestore();
    });
  });

  describe('files_view', () => {
    it('should call chrisIO.file_download and return content', async () => {
      const result = await files_view(456);
      expect(chrisIO.file_download).toHaveBeenCalledWith(456);
      expect(result).toEqual(Buffer.from('Content of file 456'));
    });
  });
});
