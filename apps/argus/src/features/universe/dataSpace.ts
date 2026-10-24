/**
 * @file The space arranged by what each feed began from: its DATA.
 *
 * The graph itself is built in `@fnndsc/menu` (`dataGraph_build`), shared
 * with the session that lays the universe out; this module re-exports it
 * for the pane.
 *
 * @module
 */
export {
  DESCRIPTION_OVERLAP,
  CAPTION_FEEDS_MIN,
  CAPTION_SHARE_MIN,
  descriptionWords_extract,
  wordOverlap_compute,
  descriptionGroups_build,
  dataPath_build,
  dataHubId_format,
  dataHubKey_parse,
  dataGraph_build,
  dataHubTip_render,
} from '@fnndsc/menu';
