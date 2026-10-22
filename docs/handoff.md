# Active project handoff: stratus (epic #1056)

- Last updated: 2026-10-22
- Last verified against `main`: the merge of #1197, 2026-10-22
- Working branches, a stack, none merged: #1200 (4a.1) ← #1201 (4a.2) ← #1202 (4b) ← #1203 (4c.1 verify) ← #1204 (4c.2 spend) ← 4d code (`agent/stratus-build`)
- Current milestone: steps 1 to 3 of the order of work in [stratus.adoc](stratus.adoc#order) are on `main`, all unpublished beyond @fnndsc/stratus 0.1.0 until the next `make publish` (the operator's word). Follow-ups 1 to 3 merged (#1190, #1191, #1192), and the four defects found along the way (#1194, #1195)
- Next action: the operator's word on the stack, merged in order. 4d's live build (a compact domain in a scratch compartment, billing ~$0.71/h, then `domain teardown`) waits on the operator's word on the day and on the scratch compartment's id; preflight and the installer are proven live, reading only

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

- **Three bastions, one shape, disjoint key rings.** The Hub cloud controller holds cloud keys and builds TDs, outside every tenancy it builds (no instance principal). The Hub dev bastion holds a porter door token per spoke bastion and no cloud key. A spoke bastion holds that TD's CUBE token only: no `oc`, no kubeconfig, no registry. The host shell is reached one way: chell, through porter, to calypso, and `!` under the `shell` tier. No ssh, no `oc rsh`, no other door is part of the design.
- **The dev bastion is a shell over a cohort.** A project directory with `/incoming` and `/outgoing` mounted under a policy set when the host is made (open: data readable in the shell; sealed: `/incoming` is a listing, only gated code runs against the files as a job, `/outgoing` shown per policy). Common case: code is written at the Hub and shipped as source to each spoke bastion; the exception is a developer inside under the open policy. Packaging as a plugin is an optional later exit, never the model.
- **The berth** is one string everywhere, `user@tenancy` exactly as the cloud writes it (two `@` when the user is an e-mail). The prompt shows it in full and truncates from the left when tight. `whoami` and the prompt agree.
- **Figure colours**: blue mise, green Linux, white ChRIS, red Red Hat only, orange Oracle Cloud Infrastructure, pale tints for machine boxes, amber for key files. Wordmarks as text, no logo art.
- **Red Hat gap, verified 2026-10-21**: no Red Hat product does "edit at one OpenShift, run in N others" (redhat-fl.adoc). The pitch sentence: you ship the fleet and the workspace; HARBOR is the loop between them, under policy, with provenance.

## Where the code stands

| Piece | State | Where |
|---|---|---|
| `@fnndsc/stratus` 0.1.0 | published through OIDC with provenance; trusted publisher configured | `packages/stratus`; npm page `@fnndsc/stratus` |
| Step 1a: read the tenancy | on `main` (#1181): descriptor, `CloudDriver`, fake driver and contract suite, OCI identity and compartments, `/net/oci/<tenancy>/` and `regions/`, launcher, stratus boot, `lint:stratus-deps` | `packages/stratus/src/{backend,session,cache,names,args,stratus}.ts`, `cloud/{driver.ts,fake/,oci/}`, `vfs/{tenancy,look}.ts`, `tests/` |
| Step 1b: prompt segments and the ARGUS composition | on `main` (#1187) | `packages/menu/src/messages.ts` (`promptSegmentSchema`, `segments`), `packages/menu/src/logo/tdMark.ts`, `packages/stratus/src/prompt.ts`, `packages/chell/src/core/prompt/`, `apps/argus/src/console/promptBar.ts`, `apps/argus/src/app/main.ts`, `assets/brand/td-oci.svg`, `scripts/prompt-parity.mjs` |
| Follow-ups 1 to 3 | on `main`: `chell --remote <berth>` by the exact identity, two-@ too (#1190, `packages/chell/src/remote/berthTarget.ts`); a frame-alone session boots unzoomed (#1191); the attach splash follows the backend, the TD mark for stratus (#1192, `packages/chell/src/remote/splash.ts`) | |
| Defects found on the way | on `main`: a non-ChRIS attach greets without the `motd` refusal or ChRIS packages; a remote line's live output goes to the sink it was sent from (#1194); `ls -l` pads owners to the widest; text filters say the session's files (#1195) | `packages/chell/src/core/greeting.ts`, `packages/chell/src/remote/remoteEngine.ts`, `packages/brasa/src/core/version.ts` (`versionsForBackend_of`), `packages/fond/src/vfs/render.ts` |
| Step 2: resources in the tree | on `main` (#1193): one driver method per kind plus `objects_list links_list object_read records_list resources_search`; every container level holds `instances networks loadbalancers volumes buckets dns` for the session's region; verified live and read-only against `fnndsc-bch` on 2026-10-21 | `packages/stratus/src/cloud/{driver.ts,fake/driver.ts,oci/resourceApi.ts,oci/resourceMap.ts,oci/driver.ts}`, `vfs/{resources,tenancy,look}.ts`, `backend.ts` |
| Step 3: domains, read | on `main` (#1196, #1197): `stratus --domain <name>=<harbor-oci checkout>`; `domains/<name>/` with `spec.yaml settings state.json steps/ auth/`, steps read from the evidence harbor-oci keeps; `domain status` and `capacity` with the `stratus.domains` and `stratus.capacity` models; the DOMAINS and CAPACITY tiles. Not built: `domain verify` and `spend` (see open questions) | `packages/stratus/src/{domains/harborOci.ts,vfs/domains.ts,commands/domain.ts,commands/capacity.ts,args.ts}`, `packages/menu/src/substrate.ts`, `apps/argus/src/compositions/stratus/tiles.ts` |
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

**A chell attached under a pty** (the prompt is interactive): `pty.fork()` with the same four variables and `HOME`, `node packages/chell/dist/index.js --remote <the URL above>`, read until the prompt, write lines, strip ANSI. Attaching by the printed URL or by the berth (`chell --remote rudolph@fnndsc`) both work.

**ARGUS screenshots** without Playwright: `apps/argus/tests/smoke/driver.mjs` exports `page_open(url)` returning `{ eval, shot, send, close }` over CDP. Run with `SMOKE_CHROME_BIN=$HOME/.cache/ms-playwright/chromium-1080/chrome-linux/chrome SMOKE_CHROME_FLAGS="--no-sandbox --user-data-dir=<fresh dir>" SMOKE_CDP_PORT=<free port>`. Chromium 153 on this host cannot load loopback pages headless; the 1080 build can.

**npm's advisory endpoint flakes** (503 or a five-minute timeout on `/-/npm/v1/security/advisories/bulk`, seen 2026-10-22): the required `audit` check then fails with "audit endpoint returned an error", which is not a finding. Rerun only that job (`gh run rerun <run> --failed`) until it answers, then `make merge` alone. With strict protection every merge makes the next PR BEHIND; `make rebase` first when its last checks were red, since `make merge` rebases only on BEHIND or DIRTY.

**Build order** when types cross packages: `npm run build -w @fnndsc/menu`, then stratus, chell, calypso, argus as needed (`npm run build` at the root builds all in order).

**Figure re-export**: strip the Design wrapper (`support.js` line, `<x-dc>`, `<helmet>`, the `text/x-dc` script), screenshot with the 1080 chromium at `--force-device-scale-factor=2 --window-size=1680,<h+80>`, crop to the board size, save under `docs/images/`.

## Follow-up still open

### Follow-up 4: epic #1056's body

The epic body still says "no code yet". Post a status comment pointing at this file and the merged PRs; do not rewrite the operator's body.

## Steps 4 and on

Settled 2026-10-22 and written into stratus.adoc (D3, D4, D6, D7, D8, D10, D11, D13, order of work): harbor-oci is never run; three driver kinds (cloud, installer, cluster) with the steps written once in `domain/steps.ts`; Terraform through OCI Resource Manager; brasa core's runner with `kill` and `wait`; the `tasks` tier as a launch-time gate, and without it nothing changes outside the host; domain state under `$XDG_STATE_HOME/stratus/domains/<name>/` with the stack tagged for rediscovery; the live domain adopted for plans only; verify in two modes; teardown's first form, which removes the domain's tagged CSI volumes and is confirmed by typing the name. The order: 4a runner and tier on fakes, 4b adoption (plan only), 4c verify and spend, 4d a real build in a scratch compartment on the operator's word; then the cluster in the tree, then the controller against its mockup. Each is its own PR; do not start one unasked.

## Open questions, for the operator

- Who runs the sealed job in a spoke bastion: the same container with the mount hidden from the shell, or a job the session launches (dev-bastion.adoc, open).
- How source crosses the wire from the Hub dev bastion to a spoke bastion, and what the gate is.
- The Hub bastion as a pod on the Hub cluster: entrypoint, mounted Secrets, who may reach its porter.
- Whether the spoke bastion is OpenShift Dev Spaces or a plain Deployment.
- Whether the Version Packages flow should stage publishes rather than allow direct publish per package (npm warns; today all packages allow direct publish).

## Working with the operator

Discussion first, code after: "DO NOT DRAW" and "comment first" are literal. In discussion, answer what was asked and stop; no closing recommendations. When the operator corrects a frame, re-read every sentence that used the frame, not only the ones that named it. Verify visually and send the renders (`SendUserFile`) before saying a visual slice is done. Report outcomes plainly: what passed, what failed, what was skipped.
