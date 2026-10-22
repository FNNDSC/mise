# Active project handoff: stratus (epic #1056)

- Last updated: 2026-10-21
- Last verified against `main`: the merge of #1187 (stratus 1b), 2026-10-21
- Working branches: `agent/remote-berth-exact` (#1190, follow-up 1), `agent/frame-alone-stage` (#1191, follow-up 2), `agent/td-mark-splash` (#1192, follow-up 3), `agent/stratus-resources` (step 2); each waits for the operator's review and merge
- Current milestone: step 1 of the order of work in [stratus.adoc](stratus.adoc#order) is on `main`: 1a (#1181, published as @fnndsc/stratus 0.1.0) and 1b (#1187, unpublished until the next `make publish`). Follow-ups 1 to 3 and step 2 are in open PRs.
- Next action: the operator reviews and merges the four PRs; follow-up 4 (the epic's status comment) was not asked for in this round; then step 3 (domains, read), after a grill

This file is the handoff between sessions and between models. It says where the work stands and what to do next, with the facts a fresh context needs to do it without rediscovery. The design itself is [stratus.adoc](stratus.adoc); the bastions are [bastion.adoc](bastion.adoc) and [dev-bastion.adoc](dev-bastion.adoc); what Red Hat ships against the primitive is [redhat-fl.adoc](redhat-fl.adoc); the metaphor every figure is drawn in is [linux-metaphor.adoc](linux-metaphor.adoc).

## House rules that bind every step

These are enforced by the operator in review and most by lint. Read the pointed files before the first commit.

- **Git and GitHub only through Makefile targets**: `make sync`, `make branch BR=…`, `make save MSG="…"`, `make pr`, `make rebase`, `make merge`, `make tidy BR=…`, `make publish`, `make verify-npm`. `MSG` is one line, no `!`, subject ≤ 72 characters; put detail in the PR body with `gh pr edit N --body-file …`.
- **`make merge` runs alone**, never piped, never chained with `;` or `&&`. Then `gh pr view N --json state` must print `MERGED` before `make tidy` is typed. A pipe into `tail` hides make's exit code; twice a red merge followed by tidy deleted a live branch and closed its PR. A PR whose checks went red before a fix landed on `main` needs `make rebase` first; `make merge` rebases only when GitHub says BEHIND or DIRTY.
- **No AI attribution** in commits or PR bodies. No process jargon (phase, wave, remediation) in source or config comments.
- **All CI lints before every push**: `for t in lint:tests lint:seam lint:casts lint:kernel lint:fond lint:trek lint:core-deps lint:stratus-deps lint:commands lint:prompt lint:wire lint:listings lint:changesets lint:aegis lint:orrery lint; do npm run -s $t || echo FAIL $t; done`, plus `node packages/stratus/scripts/stratusBoot.mjs` and `node packages/brasa/scripts/coreBoot.mjs`.
- **One test file at a time while iterating**: `cd packages/<pkg> && NODE_OPTIONS='--experimental-vm-modules --disable-warning=ExperimentalWarning' timeout 110 npx jest tests/<file>`. Never `npm test -- file`, never bare `npx jest`. Strip ANSI and grep `●|Tests:|FAIL|does not meet` when reading output.
- **Changesets**: one per package touched, package names exactly as the workspace spells them (`@fnndsc/argus`, not `argus`), first sentence ≤ 120 characters (it is the operator's WHAT'S NEW row); `npm run lint:changesets`. Docs-only PRs carry none.
- **AEGIS**: every ARGUS surface decision lands as a dated row at the top of the Status table in `apps/argus/docs/aegis.adoc` in the same PR; `npm run lint:aegis`. `components.adoc` beside it is the reference for a new component.
- **Never touch the operator's daemon.** Live checks run on a private daemon (recipe below). Never `pkill` by pattern; kill one pid.
- **Docs say what a thing is**, never where work stands; this file and changesets are the exceptions. No hard-wrapped paragraphs in `.adoc`.
- **TypeScript style**: `packages/*/TYPESCRIPT-STYLE-GUIDE.md`; RPN names (`thing_verb`), explicit types, JSDoc on every export.
- **Design from the tree**: a new path, kind or verb is argued from what ChRIS already mounts (`/net/pacs`, `/proc/jobs`), never from the document under review.
- **Analogy guard**: before writing "X is really a Y", ask what runs it and where. A matched name is not an argument. The dev bastion is a shell over a cohort, not a plugin; never reintroduce the plugin frame or `chris_plugin` scaffolding into the bastion material.

## Decisions settled this week (do not reopen)

- **Three bastions, one shape, disjoint key rings.** The Hub cloud controller holds cloud keys and builds TDs, outside every tenancy it builds (no instance principal). The Hub dev bastion holds a porter door token per spoke bastion and no cloud key. A spoke bastion holds that TD's CUBE token only: no `oc`, no kubeconfig, no registry. The host shell is reached one way: chell, through porter, to calypso, and `!` under the `tasks` tier. No ssh, no `oc rsh`, no other door is part of the design.
- **The dev bastion is a shell over a cohort.** A project directory with `/incoming` and `/outgoing` mounted under a policy set when the host is made (open: data readable in the shell; sealed: `/incoming` is a listing, only gated code runs against the files as a job, `/outgoing` shown per policy). Common case: code is written at the Hub and shipped as source to each spoke bastion; the exception is a developer inside under the open policy. Packaging as a plugin is an optional later exit, never the model.
- **The berth** is one string everywhere, `user@tenancy` exactly as the cloud writes it (two `@` when the user is an e-mail). The prompt shows it in full and truncates from the left when tight. `whoami` and the prompt agree.
- **Figure colours**: blue mise, green Linux, white ChRIS, red Red Hat only, orange Oracle Cloud Infrastructure, pale tints for machine boxes, amber for key files. Wordmarks as text, no logo art.
- **Red Hat gap, verified 2026-10-21**: no Red Hat product does "edit at one OpenShift, run in N others" (redhat-fl.adoc). The pitch sentence: you ship the fleet and the workspace; HARBOR is the loop between them, under policy, with provenance.

## Where the code stands

| Piece | State | Where |
|---|---|---|
| `@fnndsc/stratus` 0.1.0 | published through OIDC with provenance; trusted publisher configured | `packages/stratus`; npm page `@fnndsc/stratus` |
| Step 1a: read the tenancy | on `main` (#1181): descriptor, `CloudDriver`, fake driver and contract suite, OCI identity and compartments, `/net/oci/<tenancy>/` and `regions/`, launcher, stratus boot, `lint:stratus-deps` | `packages/stratus/src/{backend,session,cache,names,args,stratus}.ts`, `cloud/{driver.ts,fake/,oci/}`, `vfs/{tenancy,look}.ts`, `tests/` |
| Step 1b: prompt segments and the ARGUS composition | on `main` (#1187); its changesets (menu, chell, stratus minor; argus minor) wait in the next Version Packages PR, released by `make publish` on the operator's word | `packages/menu/src/messages.ts` (`promptSegmentSchema`, `segments`), `packages/menu/src/logo/tdMark.ts`, `packages/stratus/src/prompt.ts`, `packages/chell/src/core/prompt/{theme_p10k,theme_default,utils,index}.ts`, `apps/argus/src/console/promptBar.ts`, `apps/argus/src/app/main.ts` (stratus splash, favicon, note), `apps/argus/index.html` + `lcars/argus.css` (`data-composition="stratus"` seams), `assets/brand/td-oci.svg`, `scripts/prompt-parity.mjs` |
| Step 2: resources in the tree | open PR from `agent/stratus-resources`: `CloudDriver` gains one method per kind plus `objects_list links_list object_read records_list resources_search`; the fake fixture holds a small Trusted Domain; the OCI driver maps Compute, Virtual Network, Block Storage, Load Balancing, Object Storage, DNS and Resource Search; every container level holds `instances networks loadbalancers volumes buckets dns`; verified live and read-only against `fnndsc-bch` on 2026-10-21 | `packages/stratus/src/cloud/{driver.ts,fake/driver.ts,oci/resourceApi.ts,oci/resourceMap.ts,oci/driver.ts}`, `vfs/{resources,tenancy,look}.ts`, `backend.ts` (session region, structural paths), `tests/{resources,oci}.test.ts`, `tests/support/{driverContract,ociResources}.ts` |
| Bastion documents and figures | on `main` (#1185, corrected by #1186) | `docs/bastion.adoc`, `docs/dev-bastion.adoc`, `docs/redhat-fl.adoc`, `docs/linux-metaphor.adoc`, `docs/images/*.png` |
| Figure sources | a private Design canvas owned by the operator; the repo holds the 2x PNG exports | ask the operator for the canvas; re-export is a headless-chromium screenshot of the board's HTML |

What the wire carries now: `promptline.context.segments?: Array<{key, label, value, tone}>`, tones `leader | place | identity | path | work | note | alert`. Keys stratus uses: `cloud tenancy region user domain cwd`. A surface maps tone to palette; glyphs by key in chell's `theme_p10k.ts` and ARGUS's `terminal.ts` (`lint:prompt` holds them equal).

## Recipes

**A private stratus daemon over the fake cloud** (never the operator's daemon):

```
S=<scratch>/stratus-fake; mkdir -p $S/{tmp,run,config,cache,home}
env TMPDIR=$S/tmp XDG_RUNTIME_DIR=$S/run XDG_CONFIG_HOME=$S/config XDG_CACHE_HOME=$S/cache HOME=$S/home \
  node packages/stratus/dist/stratus.js --fake </dev/null >$S/daemon.log 2>&1 & echo $! > $S/pid
grep -o 'http://127.0.0.1:[0-9]*/?token=[0-9a-f]*' $S/daemon.log
```

`HOME` must exist: the terminal console's pty chell starts there and dies with `chdir(2) failed` otherwise. Stop it with `kill $(cat $S/pid)`. Against the live tenancy, drop `--fake` and give the daemon a real `HOME` whose `~/.oci/config` holds the profile; every change that touches the tree is checked live and read-only (stratus.adoc, test strategy).

**A chell attached under a pty** (the prompt is interactive): `pty.fork()` with the same four variables and `HOME`, `node packages/chell/dist/index.js --remote <the URL above>`, read until the prompt, write lines, strip ANSI. Attaching by the printed URL works; attaching by `rudolph@fnndsc` does not (follow-up 1).

**ARGUS screenshots** without Playwright: `apps/argus/tests/smoke/driver.mjs` exports `page_open(url)` returning `{ eval, shot, send, close }` over CDP. Run with `SMOKE_CHROME_BIN=$HOME/.cache/ms-playwright/chromium-1080/chrome-linux/chrome SMOKE_CHROME_FLAGS="--no-sandbox --user-data-dir=<fresh dir>" SMOKE_CDP_PORT=<free port>`. Chromium 153 on this host cannot load loopback pages headless; the 1080 build can.

**Build order** when types cross packages: `npm run build -w @fnndsc/menu`, then stratus, chell, calypso, argus as needed (`npm run build` at the root builds all in order).

**Figure re-export**: strip the Design wrapper (`support.js` line, `<x-dc>`, `<helmet>`, the `text/x-dc` script), screenshot with the 1080 chromium at `--force-device-scale-factor=2 --window-size=1680,<h+80>`, crop to the board size, save under `docs/images/`.

## Follow-ups to land before step 2

### Follow-up 1: `chell --remote <berth>` for a stratus identity

- **Symptom**: the launcher prints `attach a surface with: chell --remote rudolph@fnndsc`; chell answers `No live calypso for rudolph@http://fnndsc` (`packages/chell/src/remote/client.ts:162`). The remote client normalises the part after `@` as a CUBE URL before it looks for a berth, so a tenancy name becomes `http://fnndsc` and no berth file matches. The daemon's berth file is written by `packages/calypso/src/daemon/berth.ts` (`berth_write`, `berth_path(identity)`), keyed by the identity string the backend gave.
- **Fix shape**: resolve a berth by the exact identity string first, and only normalise to a URL when no berth matches and the string parses as a host. Do not change what the daemon writes. The two-`@` form (`rudolph.pienaar@childrens.harvard.edu@fnndsc-bch`) must resolve too: split on the last `@`.
- **Tests**: a chell unit test for the resolver with `user@cube.example.org`, `rudolph@fnndsc`, and the two-`@` berth; a live check against the private fake daemon by berth.
- **Changeset**: `@fnndsc/chell` patch. No AEGIS row (no ARGUS change).

### Follow-up 2: a frame-alone session boots with the launcher zoomed

- **Symptom**: ARGUS over `stratus` (and over `null`) boots with `document.body.dataset.zoom === 'launcher'`: the header and the console drawer are off stage until the zoom is restored. The ChRIS composition does not do this. `zoom_set` lives in `apps/argus/src/app/main.ts` (around line 432); find where the launcher preset is raised for a session with no composition stage and why it zooms.
- **Fix shape**: a frame-alone session boots with the dashboard on stage and the header and console visible, as a ChRIS session does. Keep the zoom reachable by the operator's gesture.
- **Tests**: the smoke stage `frame-alone` (`apps/argus/tests/smoke/smoke.mjs`) asserts the header's brand mark and the console drawer are on stage; screenshots desk and phone. Then an ARGUS screenshot over the fake stratus daemon showing the TD mark in the header and the terminal console's prompt `OCI fnndsc us-ashburn-1 rudolph:…$`, sent to the operator.
- **Changeset**: `@fnndsc/argus` patch. **AEGIS row** describing the boot posture of a frame-alone session.

### Follow-up 3: the TD mark wherever a stratus session greets

- **What the operator asked** (2026-10-21): decorate the console ASCII art with the agreed OCI stratus mark, and ARGUS likewise. Slice 1b did ARGUS's console splash (the TD mark from `@fnndsc/menu/logo/td`, `tdMark_linesRender(true)`) and the header's brand mark. Still drawing ChRIS's brain or nothing: chell's own banner when it attaches to a stratus daemon, and the daemon console `stratus` opens on a TTY (`daemonConsole_run` in calypso), which prints the brain.
- **Fix shape**: the splash follows the backend id the attach answer carries (`backend: 'stratus'`): chell's banner and calypso's daemon console draw `tdMark_linesRender` for `stratus`, the brain for `chris`, nothing for another backend. The mark is already colour-coded (ring Oracle red, star blue); keep it. If chell cannot know the backend before its banner, print the banner after the attach answer.
- **Where**: chell's attach greeting in `packages/chell/src/remote/` (search for `logo_linesRender`), calypso's `daemonConsole_run` and the launch banner in `packages/calypso/src/daemon/{launch,face}.ts`.
- **Tests**: chell and calypso unit tests on the banner lines by backend id; a pty capture against the private fake daemon showing the mark.
- **Changesets**: `@fnndsc/chell` and `@fnndsc/calypso` patch.

### Follow-up 4: epic #1056's body

The epic body still says "no code yet". Post a status comment pointing at this file and the merged PRs; do not rewrite the operator's body.

## Step 2: resources in the tree

Design: stratus.adoc D4 (the tree), D5 (what a row is), D6 (read-only by default). Scope from the order of work: instances, networks (with subnets and security groups nested), load balancers, volumes, buckets and DNS under each compartment; `ls -l` types and states; cloud tags in `tags`.

- **Driver**: extend `CloudDriver` (`packages/stratus/src/cloud/driver.ts`) with one method per kind, each taking `(compartmentId, region)` and answering a typed record list, plus `resources_search(compartmentId, region)` over OCI Resource Search for counts. Keep the interface cloud-neutral: generic kinds `instances networks subnets securitygroups loadbalancers volumes buckets dns`, native detail only in `info.json`. Every new method joins the contract suite (`tests/support/`, `driverContract_describe`) and the fake driver's fixture (`FakeCloud` in `cloud/fake/driver.ts`).
- **OCI**: `cloud/oci/api.ts` gains the per-service SDK clients (`oci-core`, `oci-loadbalancer`, `oci-objectstorage`, `oci-dns`, `oci-resourcesearch`, already dependencies or added as per-service packages, never `oci-sdk`); `cloud/oci/driver.ts` maps records to the generic shapes. `lint:stratus-deps` keeps `oci-*` imports inside `cloud/oci/`. Recorded answers for the contract suite follow `tests/oci.test.ts`'s `recordedApi_make`.
- **Tree**: `vfs/tenancy.ts` adds the kind folders beside child compartments at every compartment level (`TENANCY_RESERVED`, `CONTAINER_RESERVED`), each resource a folder of field files (`name id state region created tags info.json` plus the kind's own: instance `shape zone ips`, volume `size attached`, load balancer `ip shape`; a bucket's objects as files with a `link` field; a DNS zone's records as files). Duplicate display names wear `~<id6>` (`names.ts`). Structural paths include every kind folder. Answers cached a minute (`cache.ts`).
- **Look**: `vfs/look.ts` gives each kind its type word and state colour (`stratusName_colorize`), consistent with the ChRIS listing look.
- **Tests**: tenancy provider tests over the fake driver for every kind, duplicate names, the field files, `cat info.json`; the contract suite on fake and recorded OCI; stratus boot still loads no ChRIS package. Live read-only against the tenancy before the PR is opened: `ls -l /net/oci/<tenancy>/<compartment>/instances` and friends, screenshots or transcripts to the operator.
- **Changeset**: `@fnndsc/stratus` minor. No AEGIS row unless ARGUS changes.
- **Size**: one PR if the driver and tree land together with the fake; two if OCI recording proves slow (fake and tree first, OCI driver second).

## Step 3: domains, read

Design: D4 (`domains/`), D12 (handoff later), the harbor-oci facts in stratus.adoc's "What exists". The live compact cluster is the first domain, read over the existing `~/src/harbor-oci/state/` folder (`state/harbor.json`, Terraform state, `state/auth/`): `domains/harbor/` with `spec.yaml`, `state.json`, `steps/<nn-name>/ state log started ended`; `domain status`, `domain verify` (wrapping `harboroci verify` read-only), `spend` (wrapping `burn`); the DOMAINS and CAPACITY tiles in the ARGUS stratus composition.

- **Where**: a `domains` provider in `vfs/`, a `domain` command family registered by the backend (`Backend.commands`, see brasa's `chris/` commands for the shape and `lint:commands` for the declaration gate), and `apps/argus/src/compositions/stratus/tiles.ts` returning a `TileContribution` (`apps/argus/src/app/dashboardTiles.ts`), wired in `main.ts` where the ChRIS tiles are, under `backend === 'stratus'`.
- **Secrets never cross the wire**: kubeconfig and kubeadmin password stay on the host (D8); `cat` and `/vfs` refuse them with the host path.
- **Tests**: provider tests over a fixture state folder; command tests; ARGUS unit test for the tile source; smoke stage for the stratus dashboard against the fake daemon. **AEGIS rows** for the tiles.

## Steps 4 and on

As the order of work lists them: the supervised runner and the `tasks` tier (#986) with `domain plan` and `domain build` running `harboroci` steps as tasks and the STEPS tile; the cluster in the tree over a domain's kubeconfig; the TD controller (mockup and grill first, D13); data writes; teardown (designed on its own); the handoff to the domain session and the TD brand on it; porting until harbor-oci retires. Each is its own grill with the operator before code; do not start one unasked.

## Open questions, for the operator

- Who runs the sealed job in a spoke bastion: the same container with the mount hidden from the shell, or a job the session launches (dev-bastion.adoc, open).
- How source crosses the wire from the Hub dev bastion to a spoke bastion, and what the gate is.
- The Hub bastion as a pod on the Hub cluster: entrypoint, mounted Secrets, who may reach its porter.
- Whether the spoke bastion is OpenShift Dev Spaces or a plain Deployment.
- Whether the Version Packages flow should stage publishes rather than allow direct publish per package (npm warns; today all packages allow direct publish).

## Working with the operator

Discussion first, code after: "DO NOT DRAW" and "comment first" are literal. In discussion, answer what was asked and stop; no closing recommendations. When the operator corrects a frame, re-read every sentence that used the frame, not only the ones that named it. Verify visually and send the renders (`SendUserFile`) before saying a visual slice is done. Report outcomes plainly: what passed, what failed, what was skipped.
