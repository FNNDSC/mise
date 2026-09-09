/**
 * @file The slice of dcmjs the image pane writes with: a dataset to a Blob.
 * dcmjs ships no types.
 */
declare module 'dcmjs' {
  export const data: {
    datasetToBlob(dataset: Record<string, unknown>): Blob;
  };
  const dcmjs: { data: typeof data };
  export default dcmjs;
}
