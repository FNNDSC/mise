/**
 * @file The leading tracks every PACS level and the query form share, so a
 * term is typed in the column it will fill: the fold, PATIENT and MRN.
 *
 * One declaration, read by the patient level, the study level and (through
 * the study level's template) the form. A level that spells its own widths
 * drifts, and the form has a cell for every leading track, the listing's
 * control column included — #825: the form fell a column off its caps when
 * the facade minted a control track the form had no cell for. The aegis
 * lint holds both (a-fact-has-one-source).
 */
export const PACS_LEAD_TRACKS: Readonly<{ fold: string; patient: string; mrn: string }> = {
  fold: '5.2em',
  patient: '13em',
  mrn: '7.5em',
};
