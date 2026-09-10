/**
 * @file The slice of dcmjs the image pane writes with: a dataset to a Blob.
 * dcmjs ships no types.
 */
declare module 'dcmjs' {
  export const data: {
    datasetToBlob(dataset: Record<string, unknown>): Blob;
    DicomMessage: { readFile(buffer: ArrayBuffer, options?: { ignoreErrors?: boolean }): { dict: Record<string, unknown>; meta: Record<string, unknown> } };
    DicomMetaDictionary: { naturalizeDataset(dict: Record<string, unknown>): Record<string, unknown> };
  };
  const dcmjs: { data: typeof data };
  export default dcmjs;
}
