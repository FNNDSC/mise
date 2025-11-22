import {
  files_getGroup,
  files_getSingle,
  files_share,
  files_view,
  FileShareOptions,
  FileViewOptions
} from '../src/files/index';
import {
  objContext_create,
  chrisContext,
  Context,
  errorStack,
  ChRISEmbeddedResourceGroup
} from '@fnndsc/cumin';
import { FileBrowserFolder } from '@fnndsc/chrisapi';

jest.mock('@fnndsc/cumin');
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

  });

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

  describe('files_share', () => {
    it('should log sharing info and resolve', async () => {
      const consoleSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
      const options: FileShareOptions = { userId: 1, permission: 'read' };
      await files_share(123, options);
      expect(consoleSpy).toHaveBeenCalledWith('Sharing file 123 with options:', options);
      consoleSpy.mockRestore();
    });
  });

  describe('files_view', () => {
    it('should log viewing info and return placeholder content', async () => {
      const consoleSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
      const options: FileViewOptions = { format: 'text' };
      const result = await files_view(456, options);
      expect(consoleSpy).toHaveBeenCalledWith('Viewing file 456 with options:', options);
      expect(result).toBe('Content of file 456');
      consoleSpy.mockRestore();
    });
  });
});
