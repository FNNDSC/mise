# Reference research for `docs/lineage.adoc` and `docs/principles.adoc`

Research date: 2026-08-26.

Nearly all of the citations discussed here now live in
[lineage.adoc](lineage.adoc), the companion essay; `principles.adoc` states the
rules and cites nothing. The note keeps its original name because it is linked
from elsewhere.

This note maps the architectural claims in those documents to primary or
canonical sources, in the same spirit as
[mise-references.md](mise-references.md): a citation to an architectural pattern
establishes that the pattern exists and has been studied, **not** that this
repository implements it correctly. Claims about `mise` itself are settled by
source, measurement, or project history, and are marked as such below.

Citation keys match the `[bibliography]` block in `lineage.adoc`. Where a key
also appears in `mise.adoc`, the same key name is reused deliberately.

## Claim-to-source map

### Separating dialogue from presentation

| Claim | Source(s) | What the source supports | Qualification |
|---|---|---|---|
| An interactive system can be decomposed into application, dialogue, and presentation, with the dialogue layer mediating between them. | Pfaff, *User Interface Management Systems* (`seeheim-1985`). | The Seeheim workshop proceedings are the origin of the three-layer decomposition and of "dialogue" as a named architectural component. | **Verified secondarily only.** The attribution (Pfaff as editor, Springer, 1985) is consistent across the HCI literature, but no primary copy was inspected during this sweep. Confirm against the volume before relying on a page-level citation. |
| The dialogue component is the keystone of an interactive system's runtime architecture. | UIMS Tool Developers Workshop, *A metamodel for the runtime architecture of an interactive system* (`arch-1992`). | The Arch/Slinky metamodel, refining Seeheim, with the dialogue component central. | Authorship is corporate (a workshop, not named authors); cite it that way. DOI verified against the ACM record. |
| `mise`'s session daemon is the dialogue layer and its surfaces are presentation. | — | — | **Project claim, not sourced.** Seeheim and Arch describe a decomposition; that CALYPSO occupies that position is an architectural reading of this codebase. |

### One kernel, many surfaces

| Claim | Source(s) | What the source supports | Qualification |
|---|---|---|---|
| A documented wire protocol lets many frontends attach to one execution kernel. | Kluyver et al. (`jupyter-2016`); Jupyter messaging spec (`jupyter-messaging`). | Jupyter's kernel/frontend split and the message protocol that makes it work; the 2016 paper notes over 50 kernel implementations. | Establishes the shape is viable at ecosystem scale. Does not establish that Jupyter's frontends are *co-equal*, which is a separate and weaker claim. |
| Decoupling capability from the editor lowers the cost of supporting many editors. | LSP specification (`lsp-spec`); Bünder (`lsp-bunder-2019`). | The protocol itself, plus a peer-reviewed case study building one DSL's editor support for two IDEs, with a SWOT analysis. | Bünder studies textual DSLs in IDEs. Generalising to "any kernel/surface split" is analogy, not a result. DOI verified against SciTePress (`10.5220/0007556301290140`); an earlier draft of this bibliography carried a wrong DOI, now corrected. |
| Neither Jupyter nor LSP makes a text path normative. | — | — | **Analytical claim.** Argued from the absence of such a requirement in the cited specifications; it is not a statement either source makes about itself. |

### Structure on the pipeline

| Claim | Source(s) | What the source supports | Qualification |
|---|---|---|---|
| Unix composes small programs through text streams and pipes. | Ritchie and Thompson (`unix-1974`). | The original description of filters and pipelines. | Reused from `mise-references.md`. |
| Piping structured objects rather than text is a deliberate alternative design, with stated motivations. | Snover, *Monad Manifesto* (`monad-2002`). | The first-party design argument that became PowerShell: pipelines of objects rather than parsed text. | A design manifesto by its author, not a peer-reviewed evaluation. It supports *intent and rationale*, not measured superiority. |
| A modern shell can carry typed values end-to-end through a pipeline. | The Nushell Book (`nushell-book`). | First-party documentation of structured values (tables, records, lists) flowing between commands. | Project documentation, not an independent study. Cite for existence of the design, not for comparative claims. |
| `mise`'s envelope model is this move applied above a domain API. | — | — | **Project claim.** The analogy is ours; see `envelope-model.adoc`. |

### Every affordance is a command

| Claim | Source(s) | What the source supports | Qualification |
|---|---|---|---|
| A uniform, named command vocabulary can serve as the extension and interface model for a large interactive system. | Stallman (`emacs-1981`). | First-party description of EMACS's organisation, its extensibility through an interpreted command language, and self-documentation. | The paper appears in both *ACM SIGPLAN Notices* 16(6) and the *SIGOA Newsletter* with distinct DOIs; the proceedings DOI is used here. The paper describes 1981 EMACS, not present-day GNU Emacs. |
| Emacs refused frontend-only affordances and thereby avoided surface divergence. | — | — | **Maintainer observation, not sourced.** Stated in `lineage.adoc` as a characterisation of a design culture over decades. Treat as argument, not evidence. |

### Text as interface, namespaces, and detachable sessions

| Claim | Source(s) | What the source supports | Qualification |
|---|---|---|---|
| A text-normative system need not look like a terminal: any text in a graphical surface can be executable as a command. | Pike, *Acme: A User Interface for Programmers* (`acme-1994`). | First-party description of a hybrid window system, shell and editor in which text is uniformly executable. Verified: USENIX Winter 1994 Technical Conference, San Francisco, January 1994. | Acme is a programmer's environment on Plan 9, not a multi-surface client of a remote platform. It supports the *possibility* claim — text-normative need not mean terminal-shaped — and nothing about `argus` specifically. |
| Commands can be invocable from any text, system-wide. | Wirth and Gutknecht, *The Oberon System* (`oberon-1989`). | A whole system organised around that idea. Verified: *Software: Practice and Experience* 19(9), pp. 857–893. | Cited as corroboration of the pattern's depth, not as a direct influence on this design. |
| Resources can be reached through a navigable namespace rather than service-specific APIs. | Pike et al., *The Use of Name Spaces in Plan 9* (`plan9-namespaces-1993`). | Per-process namespaces and file-shaped access to heterogeneous resources. | Reused from `mise-references.md`. Plan 9's namespaces are local and kernel-supported; `mise`'s are a client-side projection of a remote resource graph. The analogy is structural, not mechanical. |
| A live session can persist independently of the client displaying it, with many clients attaching. | `tmux` (`tmux`). | Working software implementing detachable sessions. | Software, not literature — no paper exists. Cite for the existence of the pattern only. |
| An application and its display can be separated across a wire. | Scheifler and Gettys, *The X Window System* (`x-window-1986`). | The canonical client/server display split. Verified: *ACM TOG* 5(2), pp. 79–109. | Establishes the antiquity of the split. X separates *rendering*; CALYPSO separates *session state*. Do not overstate the parallel. |
| `mise` makes the namespace the organising model for a graphical surface, unlike the prevailing SPA-over-REST pattern in this domain. | — | — | **Project claim and comparative assertion.** The comparison to `ChRIS_ui` and similar clients is a maintainer observation; no systematic survey was performed. |
| A system can invert the application/document relationship, summoning a presenter based on what the content is. | Sakamura, *BTRON: The Business-oriented Operating System* (`btron-1987`). | First-party description of the BTRON design by the TRON project's originator. Verified: *IEEE Micro* 7(2), pp. 53–65, April 1987. | **The paper itself was not read** — IEEE/ACM records were paywalled or returned 403 during this sweep. Bibliographic data verified against the ACM DL record; the *design description* in `lineage.adoc` (real object / virtual object, TAD chunk skipping, document-first workflow) is drawn from secondary summaries. Confirm against the paper before relying on any specific claim. |
| TAD carried typed chunks with length headers so an application could skip unsupported data and render the rest. | Secondary summaries of the TAD specification. | The graceful-degradation property of the format. | **Secondary only.** The parallel drawn to the envelope model is ours and is structural, not historical — there is no evidence of influence in either direction. |
| Document-centric computing has repeatedly failed in the market for economic rather than technical reasons. | — | — | **Maintainer argument, not sourced.** The examples (BTRON, OpenDoc, OLE compound documents, Cairo/WinFS) are industry history stated from general knowledge; no citation is offered and none should be inferred. The claim about BTRON's 1989 Super 301 episode is likewise summarised, not sourced. Treat the whole paragraph as argument. |

### Fingerprinting and agentic non-determinism

| Claim | Source(s) | What the source supports | Qualification |
|---|---|---|---|
| A hash chain over content and ancestors yields a verifiable structure whose identity depends on its whole history. | Merkle (`merkle-1987`). | The original hash-tree construction. DOI, volume (LNCS 293) and pages (369–378) verified. | Merkle addresses digital signatures. Its use for build staleness or interaction identity is downstream application, not something the paper claims. |
| Non-determinism is intrinsic to LLM output and evaluation that ignores it is unsound. | Song, Wang, Li, and Lin (`nondeterminism-naacl-2025`). | Peer-reviewed (NAACL 2025, pp. 4195–4206) study of greedy versus sampled decoding across benchmarks, and of the resulting evaluation error. | Concerns evaluation of model outputs. It does **not** address agent interaction traces, which is the use made of it here; it supports "the problem is real and measured," no more. |
| Agent executions are not faithfully reproducible without capturing external interaction. | Mudasiru, *Deterministic Replay for AI Agent Systems* (`agent-replay-2026`). | A proposed framework (`agrepl`) that proxies and replays external interactions, with claimed perfect replay fidelity and a formalised execution model. | **arXiv preprint; not peer-reviewed.** Reported figures (e.g. a 98.3% latency reduction) are the author's and were not independently checked. Cited for the existence and shape of the problem, not for its results. |
| An interaction DAG records *structure* where replay records a *trace*, making two runs comparable rather than merely re-executable. | — | — | **Our claim, and unbuilt.** This is the forward-work section's central proposition. Nothing in the cited literature asserts it, and nothing in this repository implements it yet. |

### Claims that only project evidence can settle

These appear across both documents (mostly in `lineage.adoc`) and are deliberately **not** supported by
citation. They are established, if at all, by this repository:

- That CUBE's Collection+JSON model is "architecturally incomplete" and that
  `mise` completes it. This is the thesis of `mise.adoc` and the
  [intent-server](https://github.com/FNNDSC/intent-server) study, argued there.
- That plugin instances are immutable and feeds append-only, and therefore that
  nothing is recomputed. Verify against CUBE's data model before relying on it;
  it is currently asserted from client-side behaviour.
- Every entry in the Known Violations section of `principles.adoc`: each is a statement about this
  codebase at a named file and line, and each was confirmed by reading the source
  during the 2026-08-26 sweep.
- The observation that co-equal surfaces drift apart under unequal investment.
  Argued from ecosystem history, offered as a caution rather than a finding.

## Sources consulted

- Stallman, EMACS: <https://dl.acm.org/doi/10.1145/800209.806466>
- Arch metamodel: <https://dl.acm.org/doi/10.1145/142394.142401>
- Kluyver et al., Jupyter: <https://doi.org/10.3233/978-1-61499-649-1-87>
- Jupyter messaging spec: <https://jupyter-client.readthedocs.io/en/latest/messaging.html>
- LSP specification: <https://microsoft.github.io/language-server-protocol/specifications/lsp/3.17/specification/>
- Bünder, MODELSWARD 2019: <https://www.scitepress.org/Papers/2019/75563/pdf/index.html>
- Snover, Monad Manifesto: <https://www.jsnover.com/Docs/MonadManifesto.pdf>
- Nushell Book, Pipelines: <https://www.nushell.sh/book/pipelines.html>
- Merkle, CRYPTO '87: <https://doi.org/10.1007/3-540-48184-2_32>
- Song et al., NAACL 2025: <https://aclanthology.org/2025.naacl-long.211/>
- Mudasiru, arXiv:2607.16200: <https://arxiv.org/abs/2607.16200>
- Pike, Acme (USENIX Winter 1994): <https://research.swtch.com/acme.pdf>
- Wirth and Gutknecht, Oberon: <https://doi.org/10.1002/spe.4380190905>
- Scheifler and Gettys, X: <https://doi.org/10.1145/22949.24053>
- tmux: <https://github.com/tmux/tmux>

## Threads not chased

Named here so a later sweep does not have to rediscover them:

- **Smalltalk's image** — the live session as the durable artifact rather than the
  file. Ingalls, *Design Principles Behind Smalltalk* (BYTE, 1981) is the usual
  citation; not verified during this sweep, so it is deliberately absent from the
  bibliography.
- **Make and data-state DAGs** — the "a target is current if its artifact is newer
  than its inputs" model, which is the direct ancestor of the exploration's
  fingerprinting. Feldman, *Make — A Program for Maintaining Computer Programs*
  (1979). Worth adding if the interaction-DAG work proceeds.
- **Content-addressed build systems** (Nix, Bazel) — the modern form of the same
  idea, and the closest prior art to fingerprint-keyed caching of derived state.
