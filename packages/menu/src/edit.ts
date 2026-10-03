/**
 * @file What can be opened as text in an editor: one list, read by the
 * kernel's `edit` (which refuses the rest by name) and by every surface that
 * offers EDIT on a file, so the offer and the refusal cannot disagree.
 *
 * @module
 */

/** File extensions that hold bytes, not text: `edit` refuses them. */
export const EDIT_BINARY_EXTENSIONS: ReadonlySet<string> = new Set([
  '.dcm', '.png', '.jpg', '.jpeg', '.gif', '.bmp', '.webp', '.ico',
  '.pdf', '.zip', '.tar', '.gz', '.bz2', '.xz', '.7z',
  '.exe', '.dll', '.so', '.bin', '.mp3', '.mp4', '.avi', '.wav',
  '.nii', '.mgz',
]);

/** The size at or above which a surface asks before opening a file in its editor, bytes. */
export const EDIT_CONFIRM_BYTES: number = 1024 * 1024;

/**
 * A path's extension, with its dot, lower case; empty when it has none.
 *
 * @param path - The path.
 * @returns The extension.
 */
export function editExtension_of(path: string): string {
  const name: string = path.split('/').pop() ?? path;
  const dot: number = name.lastIndexOf('.');
  return dot > 0 ? name.slice(dot).toLowerCase() : '';
}

/**
 * Whether a file can be opened as text.
 *
 * @param path - The path.
 * @returns False for a binary extension (a `.nii.gz` volume included).
 */
export function path_isEditable(path: string): boolean {
  return !EDIT_BINARY_EXTENSIONS.has(editExtension_of(path));
}
