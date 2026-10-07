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
  descriptionWords_of,
  wordOverlap_of,
  descriptionGroups_of,
  dataPath_of,
  dataHubId_of,
  dataHubKey_of,
  dataGraph_build,
  dataHubTip_of,
} from '@fnndsc/menu';
