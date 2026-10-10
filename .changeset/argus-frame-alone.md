---
"@fnndsc/argus": minor
"@fnndsc/calypso": minor
"@fnndsc/porter": patch
---

ARGUS over a backend other than ChRIS shows the frame alone: files, the console and its own tiles (#985). Before it builds, ARGUS asks the daemon `GET /backend` (token-gated; porter adds the token behind a door) and installs the ChRIS composition only for ChRIS; an older daemon is ChRIS. What ChRIS owns in the page's markup carries `data-composition`, and a saved ChRIS preset falls back to home. The FILES tile's description is the composition's (ChRIS keeps its own words). The smoke stage `frame-alone` checks both sides.
