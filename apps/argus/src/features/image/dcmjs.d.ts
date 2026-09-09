/** THROWAWAY PROTOTYPE: the slice of dcmjs the SR probe writes with. */
declare module 'dcmjs' {
  export const data: {
    datasetToBlob(dataset: Record<string, unknown>): Blob;
  };
  const dcmjs: { data: typeof data };
  export default dcmjs;
}
