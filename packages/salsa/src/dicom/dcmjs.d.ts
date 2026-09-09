/**
 * @file The slice of dcmjs the kernel uses. dcmjs ships no types; this
 * declares only what `tags.ts` calls, typed as the library actually behaves
 * (raw dictionaries keyed by eight-hex tags, values as arrays).
 */
declare module 'dcmjs' {
  /** One raw element: its VR and its value list. Sequences nest dictionaries. */
  export interface DcmjsElement {
    vr: string;
    Value?: unknown[];
  }

  /** A raw dataset: elements keyed by `ggggeeee`. */
  export type DcmjsDict = Record<string, DcmjsElement>;

  /** One dictionary entry for a public tag. */
  export interface DcmjsDictionaryEntry {
    tag: string;
    vr: string;
    vm: string;
    name: string;
    version: string;
  }

  export interface DcmjsDicomMessage {
    meta: DcmjsDict;
    dict: DcmjsDict;
  }

  export const data: {
    DicomMessage: {
      readFile(buffer: ArrayBuffer, options?: { ignoreErrors?: boolean; untilTag?: string | null; includeUntilTagValue?: boolean; noCopy?: boolean }): DcmjsDicomMessage;
    };
    DicomMetaDictionary: {
      dictionary: Record<string, DcmjsDictionaryEntry>;
      nameMap: Record<string, DcmjsDictionaryEntry>;
      sopClassNamesByUID: Record<string, string>;
      denaturalizeDataset(dataset: Record<string, unknown>): DcmjsDict;
      naturalizeDataset(dict: DcmjsDict): Record<string, unknown>;
    };
    DicomDict: new (meta: DcmjsDict) => { dict: DcmjsDict; write(): ArrayBuffer };
  };

  export const log: { setLevel(level: string | number): void };

  const dcmjs: { data: typeof data; log: typeof log };
  export default dcmjs;
}
