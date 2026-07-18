# Reference research for `docs/mise.adoc`

Research date: 2026-07-18.

This note maps claims in the draft paper to primary or canonical sources and
provides copy-ready AsciiDoc bibliography entries. It deliberately separates
published architectural precedent from claims that can only be established by
ChRIS/mise source code, measurements, or project history. A citation to an
architectural pattern is not evidence that this repository implements the
pattern correctly.

## Claim-to-source map

### ChRIS, scientific workflows, and provenance

| Claim in the paper | Best source(s) | What the source supports | Qualification |
|---|---|---|---|
| ChRIS is a distributed scientific/medical-computing platform that connects data, analysis software, and computation. | Zhang and Pienaar, *Bridging Science and Medicine with the ChRIS Research Integration System* (`chris-hicss-2026`); Pienaar et al., *ChRIS—A web-based neuroimaging and informatics system…* (`chris-embc-2015`). | First-party, peer-reviewed descriptions of ChRIS and its scientific/medical-imaging purpose. | Prefer the 2026 paper for the current architecture; use the 2015 paper for historical origin only. |
| Scientific workflow systems compose tasks, manage distributed execution, and retain information about what was run. | Deelman et al., *Pegasus, a workflow management system for science automation* (`pegasus-2015`). | A mature scientific-workflow system's account of abstract workflows, executable workflows, distributed resources, data management, and provenance. | This establishes the broader workflow lineage, not ChRIS-specific behavior. |
| Provenance is an external record relating data, processes, and responsible agents, rather than merely a UI narrative. | W3C PROV-DM (`prov-dm`); Freire et al. (`freire-provenance-2008`). | PROV-DM canonically defines entities, activities, agents, use, generation, and derivation; the survey explains computational provenance in scientific workflows. | The sentence that a particular CUBE path is itself proof of lineage needs a CUBE data-model/source citation, not only PROV. |
| A feed/plugin-instance graph and its output files are CUBE's durable execution record. | Current CUBE source and API documentation (`cube-source`), ideally plus the 2026 ChRIS paper. | The first-party implementation and API can establish which resources and relations CUBE actually persists. | Verify exact resource names and lifecycle semantics against the release discussed in the paper. General provenance literature cannot prove this implementation claim. |

### Unix composition and HPC

| Claim in the paper | Best source(s) | What the source supports | Qualification |
|---|---|---|---|
| Small programs become systems through file/stream composition and pipes. | Ritchie and Thompson, *The UNIX Time-Sharing System* (`unix-1974`); POSIX Shell and Utilities (`posix-2024`). | The original Unix paper describes filters and pipelines; POSIX is the current normative command-language/utilities reference. | The original paper supports the design lineage; POSIX supports present-day portability semantics. |
| Unix-like systems dominate high-performance scientific computing. | TOP500 operating-system-family statistics (`top500-os`). | The canonical TOP500 statistics page reports the operating-system family of listed supercomputers. | This is time-varying evidence. Keep the access date and avoid turning a current statistic into an ahistorical claim. |
| A command-line program is the most portable interface for containers and schedulers. | OCI Image Specification (`oci-image`) and the POSIX utility model (`posix-2024`) can support narrower statements. | OCI defines portable container-image configuration, including entry point and command metadata. | “Most portable” is comparative and is not established by either source. Rephrase to “a widely supported interface” or supply an empirical comparison across schedulers/container runtimes. |

### REST, hypermedia, and Collection+JSON

| Claim in the paper | Best source(s) | What the source supports | Qualification |
|---|---|---|---|
| REST includes hypermedia as the engine of application state, with clients following typed links/transitions rather than constructing all resource URLs. | Fielding's dissertation (`fielding-rest`); RFC 8288 (`rfc8288`). | Fielding is the originating REST source; RFC 8288 standardizes typed Web links and relation types. | The draft says “HASTEOS”; the established acronym is **HATEOAS**. |
| Collection+JSON represents collections, items, links, queries, and write templates in a hypermedia format. | Official Collection+JSON specification (`collection-json`) and IANA media-type registration (`collection-json-iana`). | These own the representation semantics and confirm `application/vnd.collection+json` registration. | Collection+JSON is a registered media type, not an IETF REST standard. Do not imply standards status beyond that. |
| Hypermedia reduces URL-construction knowledge but does not remove use-case sequencing, policy, retries, or satisfaction criteria from clients. | Fielding (`fielding-rest`) supports the hypermedia constraint; Evans (`evans-ddd`) and Fowler (`fowler-service-layer`) support a separate application layer/service coordinating use cases. | Together they support the distinction between resource navigation and application orchestration. | This is a synthesis, not a quotation or theorem from one source. State it as architectural analysis. |
| CUBE has remained stable while clients changed; Collection+JSON traversal is verbose; JavaScript typings lagged the live API. | Repository history, tagged CUBE/client releases, issue/PR records, and reproducible API-call examples. | Only project evidence can establish these longitudinal and implementation-specific observations. | Do not use Fielding or the Collection+JSON spec as evidence for these claims. Add release/issue references or label the statements as maintainer observations. |

### Application service and anti-corruption layer

| Claim in the paper | Best source(s) | What the source supports | Qualification |
|---|---|---|---|
| An application service coordinates a use case while domain objects retain domain rules. | Evans, *Domain-Driven Design* (`evans-ddd`); Fowler's Service Layer (`fowler-service-layer`). | These are the originator/canonical pattern descriptions for the Application Layer/Application Service and Service Layer. | “Application service” and Fowler's “Service Layer” overlap but are not perfectly interchangeable; Evans is the cleaner source for DDD wording. |
| An anti-corruption layer translates between an external model and an internal model so the former does not distort the latter. | Evans (`evans-ddd`). | Evans introduced and named the Anti-Corruption Layer pattern. | This supports the intended boundary. Evidence that `cumin` actually confines all Collection+JSON and unsafe casts must come from repository dependency/source analysis. |

### Kernel/frontend separation

| Claim in the paper | Best source(s) | What the source supports | Qualification |
|---|---|---|---|
| Jupyter separates kernels from frontends through a message protocol. | Official Jupyter messaging specification (`jupyter-messaging`). | Defines kernel/client messages, request/reply correlation, shell/control/stdin/iopub/heartbeat channels, and rich MIME-bundle outputs. | This supports the architectural seam; it does not prescribe mise's transport or session lifecycle. |
| Several frontends can connect to one kernel, and each can render a representation it understands. | Jupyter messaging specification (`jupyter-messaging`). | The official protocol discusses multiple clients and rich display data carrying multiple MIME representations. | Cite the exact protocol section when adding in-text citations; avoid claiming Jupyter provides the same authorization/session semantics as CALYPSO. |
| mise/CALYPSO has the same architectural *shape* as Jupyter. | Jupyter messaging specification plus mise's own protocol/source. | Jupyter provides a close precedent for the engine/frontend seam and structured output. | This is an analogy. “Point for point” is too strong unless differences (transport, persistence, auth, execution language) are enumerated. |

### Research method, module boundaries, and protocol seams

| Claim in the paper | Best source(s) | What the source supports | Qualification |
|---|---|---|---|
| Building and evaluating mise can be presented as design-science research. | Hevner et al. (`hevner-design-science-2004`). | The canonical IS design-science paper frames knowledge as produced through building and evaluating purposeful artifacts and supplies guidelines for rigor, relevance, and evaluation. | Citing the method does not make the paper design science by itself. The paper should identify the problem, artifact, evaluation evidence, research contribution, and limits. |
| mise is an in-depth software case whose evidence includes repository history, implementation, and observations in context. | Runeson and Höst (`runeson-host-2009`). | Primary software-engineering guidance for designing, conducting, and reporting case studies, including case/context definition, data collection, triangulation, validity threats, and reporting. | If the paper makes causal or general claims, it must state the evidence chain and limits to generalization rather than relying on the label “case study.” |
| Good module boundaries hide likely-to-change design decisions behind stable interfaces. | Parnas (`parnas-1972`). | The originator paper argues for decomposing systems around hidden design decisions rather than processing steps, to improve comprehensibility and changeability. | This supports the rationale for isolating Collection+JSON/client peculiarities; repository dependencies and change history must show that mise actually realizes the boundary. |
| A filesystem-like namespace can project heterogeneous local and remote resources into a uniform per-process view. | Pike et al. (`plan9-namespaces-1993`). | The canonical Plan 9 paper describes per-process namespaces and a uniform file protocol as foundations for composing distributed resources. | ChELL's `/home`, `/bin`, and `/proc` are analogous projections, not Plan 9 namespaces in the operating-system sense. |
| A reusable engine can be separated from heterogeneous editor/frontends by a language-neutral protocol. | Official LSP specification (`lsp-spec`) and DAP specification (`dap-spec`). | LSP standardizes editor–language-server messages; DAP standardizes development-tool–debug-adapter messages. Both are direct precedents for preventing each surface from reimplementing engine integration. | They support the protocol-seam pattern, not the scientific-state authority or intent semantics of mise. |

### Control plane, data plane, and controllers

| Claim in the paper | Best source(s) | What the source supports | Qualification |
|---|---|---|---|
| Control and data planes are distinct architectural roles. | RFC 7426 (`rfc7426`). | Provides standardized SDN layer/plane terminology and separates control from forwarding/data operations. | The terms originate in networking. Applying them to mise/CUBE is an explicit analogy, not a formal classification imposed by the RFC. |
| A controller observes current state and acts toward desired state without becoming the authority for the underlying workload data. | Kubernetes controller documentation (`kubernetes-controllers`). | Official documentation describes controllers as control loops that compare current with desired state and make changes toward the latter. | Kubernetes stores desired/current cluster state in its API; CUBE/mise ownership differs. Use the control-loop precedent, not a claim of identity. |

### CQRS and materialized projections

| Claim in the paper | Best source(s) | What the source supports | Qualification |
|---|---|---|---|
| CQRS separates models used for updates from models used for reads. | Greg Young's *CQRS Documents* (`young-cqrs`); Fowler's CQRS article (`fowler-cqrs`). | Young is the originator source; Fowler provides a concise canonical explanation and cautions against indiscriminate use. | Use CQRS as a pattern description, not as evidence that every cache constitutes CQRS. |
| A read model may be a derived/materialized projection of authoritative facts. | Blakeley, Larson, and Tompa (`blakeley-materialized-views-1986`) for the database origin; Microsoft CQRS pattern (`microsoft-cqrs`) and Fowler (`fowler-cqrs`) for the architectural application. | The 1986 paper explains why query performance can improve by storing a derived view and how base-relation updates can maintain it; the CQRS sources describe read-optimized models. | CQRS does **not** require event sourcing, nor does a projection become a second authority merely because it is stored. Say “CQRS-style read projection” unless command/query models are actually separated. |
| Caches/catalogs in mise are bounded materialized projections. | The CQRS sources establish the vocabulary; mise source/tests must establish invalidation, rebuildability, and authority boundaries. | A defensible projection should be derivable from CUBE, disposable/rebuildable, and incapable of committing scientific truth independently. | If any cache contains facts unavailable from CUBE, “projection” is misleading and the authority claim needs revision. |

### HTTP caching, notification, and idempotency

| Claim in the paper | Best source(s) | What the source supports | Qualification |
|---|---|---|---|
| Conditional retrieval can avoid transferring an unchanged representation. | RFC 9110 (`rfc9110`) for validators and conditional requests; RFC 9111 (`rfc9111`) for HTTP caches. | Current HTTP Semantics and HTTP Caching standards define ETag/Last-Modified validators, `If-None-Match`/`If-Modified-Since`, and `304 Not Modified`. | Use RFC 9110/9111, which obsolete RFC 723x for these semantics. Conditional requests require correct validator generation and cache directives. |
| Change events are distinct from cache validation/polling. | W3C WebSub (`websub`) as a canonical HTTP publish/subscribe design; RFC 6202 (`rfc6202`) for long polling/streaming tradeoffs. | Demonstrates established push/subscription and streaming patterns over HTTP. | Neither source defines ChRIS event names, ordering, replay, authorization, or delivery guarantees; those require a CUBE event contract. HTTP caching alone does not notify clients. |
| Retried action requests can be safe when the operation is idempotent. | RFC 9110 (`rfc9110`), especially the idempotent-method semantics. | Defines idempotence and the retry implications for idempotent methods. | Method idempotence does not make an arbitrary workflow launch safe. POST-like action primitives need an application-level operation/idempotency key, duplicate-detection scope, retention period, and response-replay contract. The IETF `Idempotency-Key` document remains an Internet-Draft; do not cite it as an RFC. |

### GraphQL and N+1 behavior

| Claim in the paper | Best source(s) | What the source supports | Qualification |
|---|---|---|---|
| GraphQL is a query language and execution specification, not a database. | GraphQL Specification (`graphql-spec`). | The specification defines a query language, type system, validation, and execution; it deliberately does not prescribe a storage engine. | This establishes scope, not comparative suitability for CUBE. |
| Resolver-based GraphQL servers can exhibit N+1 loading and can batch requests with DataLoader-style techniques. | Official GraphQL.js N+1/DataLoader guide (`graphql-nplus1`); DataLoader repository (`dataloader`). | First-party ecosystem documentation explains how nested resolvers can issue repeated backend loads and how request-scoped batching/caching addresses the pattern. | This proves a possible implementation pathology, not that GraphQL itself or a proposed CUBE GraphQL layer would be slow. Measure serialization, network, ORM queries, indexes, and orchestration independently as the draft says. |

### LLM tool orchestration (optional)

| Claim in the paper | Best source(s) | What the source supports | Qualification |
|---|---|---|---|
| Language models can interleave reasoning with actions against external tools. | Yao et al., ReAct (`react-2023`); Schick et al., Toolformer (`toolformer-2023`). | Primary papers establishing prominent language-model/tool-use approaches. | These support precedent for tool orchestration, not authorization, correctness, or safety. |
| A model should propose a bounded command while deterministic code validates and executes it. | Cite the tool-use papers only for the model/tool split; cite the mise protocol and threat model for the validation rule. | The decisive security property comes from the local command allowlist, schema validation, authorization checks, and receipts. | Do not claim ReAct or Toolformer proves this architecture safe. This is a mise design commitment requiring tests and threat analysis. |

## High-value corrections and evidence gaps in the draft

1. Correct `HASTEOS` to `HATEOAS`.
2. Treat “Unix-like systems dominate HPC” as a dated empirical claim and cite
   TOP500 with an access date.
3. Rephrase “the most portable interface” to “a widely supported interface”
   unless comparative evidence is added.
4. Cite the ChRIS papers and CUBE source for platform/resource claims. The
   external workflow and provenance literature supplies context, not proof of
   CUBE's exact persistence semantics.
5. The claims about API longevity, client typing drift, repeated client effort,
   and the historical role of the React/PatternFly client need project evidence
   (release history, issues, PRs, architecture records, or an explicitly labeled
   maintainer account).
6. “Control plane” is a useful analogy; acknowledge its networking origin.
7. Call caches “CQRS-style materialized read projections” only when they are
   disposable and reconstructible from CUBE.
8. Keep conditional retrieval, change notification, and action idempotency as
   three separate backend capabilities. The HTTP standards do not collapse
   them into one mechanism.
9. The GraphQL citations justify “query language, not database” and the
   *possibility* of N+1 behavior. They do not justify a performance conclusion
   about CUBE without measurements.
10. Use ReAct/Toolformer only as optional related work. The bounded-command
    authorization and receipt model is a local contribution, not a result from
    those papers.

## Copy-ready AsciiDoc bibliography

The keys are intentionally descriptive and stable. Entries without publication
dates are living official documentation; their access date is included.

```asciidoc
[bibliography]
== References

* [[[chris-hicss-2026]]] J. Zhang and R. Pienaar. Bridging Science and Medicine with the ChRIS Research Integration System. In _Proceedings of the 59th Hawaii International Conference on System Sciences_, 2026. https://doi.org/10.24251/HICSS.2026.414

* [[[chris-embc-2015]]] R. Pienaar, N. Rannou, J. Bernal, D. Hahn, and P. E. Grant. ChRIS—A web-based neuroimaging and informatics system for collecting, organizing, processing, visualizing and sharing of medical data. In _2015 37th Annual International Conference of the IEEE Engineering in Medicine and Biology Society (EMBC)_, pp. 206–209, 2015. https://doi.org/10.1109/EMBC.2015.7318336

* [[[cube-source]]] FNNDSC. ChRIS_ultron_backEnd: the ChRIS CUBE backend. Official source repository and API documentation. https://github.com/FNNDSC/ChRIS_ultron_backEnd (accessed 2026-07-18).

* [[[pegasus-2015]]] E. Deelman, K. Vahi, G. Juve, M. Rynge, S. Callaghan, P. J. Maechling, R. Mayani, W. Chen, R. Ferreira da Silva, M. Livny, and K. Wenger. Pegasus, a workflow management system for science automation. _Future Generation Computer Systems_ 46, pp. 17–35, 2015. https://doi.org/10.1016/j.future.2014.10.008

* [[[freire-provenance-2008]]] J. Freire, D. Koop, E. Santos, and C. T. Silva. Provenance for Computational Tasks: A Survey. _Computing in Science & Engineering_ 10(3), pp. 11–21, 2008. https://doi.org/10.1109/MCSE.2008.79

* [[[prov-dm]]] L. Moreau and P. Missier, editors. PROV-DM: The PROV Data Model. W3C Recommendation, 30 April 2013. https://www.w3.org/TR/2013/REC-prov-dm-20130430/

* [[[unix-1974]]] D. M. Ritchie and K. Thompson. The UNIX Time-Sharing System. _Communications of the ACM_ 17(7), pp. 365–375, 1974. https://doi.org/10.1145/361011.361061

* [[[posix-2024]]] The Open Group and IEEE. _The Open Group Base Specifications, Issue 8; IEEE Std 1003.1-2024_. 2024. https://pubs.opengroup.org/onlinepubs/9799919799/

* [[[top500-os]]] TOP500. Operating System Family / System Share statistics. https://top500.org/statistics/details/osfam/1/ (accessed 2026-07-18).

* [[[oci-image]]] Open Container Initiative. OCI Image Format Specification. https://github.com/opencontainers/image-spec (accessed 2026-07-18).

* [[[fielding-rest]]] R. T. Fielding. _Architectural Styles and the Design of Network-based Software Architectures_. Doctoral dissertation, University of California, Irvine, 2000. https://ics.uci.edu/~fielding/pubs/dissertation/top.htm

* [[[rfc8288]]] M. Nottingham. Web Linking. RFC 8288, Internet Engineering Task Force, October 2017. https://doi.org/10.17487/RFC8288

* [[[collection-json]]] M. Amundsen. Collection+JSON Hypermedia Type. Official specification. https://github.com/collection-json/spec (accessed 2026-07-18).

* [[[collection-json-iana]]] Internet Assigned Numbers Authority. Media Types: `application/vnd.collection+json`. https://www.iana.org/assignments/media-types/application/vnd.collection+json (accessed 2026-07-18).

* [[[evans-ddd]]] E. Evans. _Domain-Driven Design: Tackling Complexity in the Heart of Software_. Addison-Wesley Professional, 2003. ISBN 978-0-321-12521-7.

* [[[fowler-service-layer]]] M. Fowler. Service Layer. In _Patterns of Enterprise Application Architecture_. Addison-Wesley Professional, 2002. ISBN 978-0-321-12742-6. https://martinfowler.com/eaaCatalog/serviceLayer.html

* [[[jupyter-messaging]]] Project Jupyter. Messaging in Jupyter: the Jupyter kernel wire protocol. https://jupyter-client.readthedocs.io/en/latest/messaging.html (accessed 2026-07-18).

* [[[hevner-design-science-2004]]] A. R. Hevner, S. T. March, J. Park, and S. Ram. Design Science in Information Systems Research. _MIS Quarterly_ 28(1), pp. 75–106, 2004. https://doi.org/10.2307/25148625

* [[[runeson-host-2009]]] P. Runeson and M. Höst. Guidelines for conducting and reporting case study research in software engineering. _Empirical Software Engineering_ 14(2), pp. 131–164, 2009. https://doi.org/10.1007/s10664-008-9102-8

* [[[parnas-1972]]] D. L. Parnas. On the Criteria To Be Used in Decomposing Systems into Modules. _Communications of the ACM_ 15(12), pp. 1053–1058, 1972. https://doi.org/10.1145/361598.361623

* [[[plan9-namespaces-1993]]] R. Pike, D. Presotto, K. Thompson, H. Trickey, and P. Winterbottom. The Use of Name Spaces in Plan 9. _ACM SIGOPS Operating Systems Review_ 27(2), pp. 72–76, 1993. https://doi.org/10.1145/155848.155861

* [[[lsp-spec]]] Microsoft. Language Server Protocol Specification, version 3.17. https://microsoft.github.io/language-server-protocol/specifications/lsp/3.17/specification/ (accessed 2026-07-18).

* [[[dap-spec]]] Microsoft. Debug Adapter Protocol Specification. https://microsoft.github.io/debug-adapter-protocol/specification (accessed 2026-07-18).

* [[[rfc7426]]] E. Haleplidis, S. Denazis, J. H. Salim, D. Meyer, and O. Koufopavlou. Software-Defined Networking (SDN): Layers and Architecture Terminology. RFC 7426, Internet Research Task Force, January 2015. https://doi.org/10.17487/RFC7426

* [[[kubernetes-controllers]]] The Kubernetes Authors. Controllers. Kubernetes documentation. https://kubernetes.io/docs/concepts/architecture/controller/ (accessed 2026-07-18).

* [[[young-cqrs]]] G. Young. _CQRS Documents_. 2010. https://cqrs.files.wordpress.com/2010/11/cqrs_documents.pdf

* [[[fowler-cqrs]]] M. Fowler. CQRS. 14 July 2011. https://martinfowler.com/bliki/CQRS.html

* [[[blakeley-materialized-views-1986]]] J. A. Blakeley, P.-Å. Larson, and F. W. Tompa. Efficiently Updating Materialized Views. In _Proceedings of the 1986 ACM SIGMOD International Conference on Management of Data_, pp. 61–71, 1986. https://doi.org/10.1145/16894.16861

* [[[microsoft-cqrs]]] Microsoft. CQRS pattern. Azure Architecture Center. https://learn.microsoft.com/en-us/azure/architecture/patterns/cqrs (accessed 2026-07-18).

* [[[rfc9110]]] R. T. Fielding, M. Nottingham, and J. Reschke. HTTP Semantics. RFC 9110, Internet Engineering Task Force, June 2022. https://doi.org/10.17487/RFC9110

* [[[rfc9111]]] R. T. Fielding, M. Nottingham, and J. Reschke. HTTP Caching. RFC 9111, Internet Engineering Task Force, June 2022. https://doi.org/10.17487/RFC9111

* [[[websub]]] A. Guy and J. Genestoux, editors. WebSub. W3C Recommendation, 23 January 2018. https://www.w3.org/TR/2018/REC-websub-20180123/

* [[[rfc6202]]] G. Loreto, P. Saint-Andre, S. Salsano, and G. Wilkins. Known Issues and Best Practices for the Use of Long Polling and Streaming in Bidirectional HTTP. RFC 6202, Internet Engineering Task Force, April 2011. https://doi.org/10.17487/RFC6202

* [[[graphql-spec]]] GraphQL Foundation. GraphQL Specification, September 2025 edition. https://spec.graphql.org/September2025/

* [[[graphql-nplus1]]] GraphQL.js. Solving the N+1 Problem with DataLoader. Official documentation. https://www.graphql-js.org/docs/n1-dataloader/ (accessed 2026-07-18).

* [[[dataloader]]] GraphQL Foundation. DataLoader: DataLoader is a generic utility to be used as part of an application's data fetching layer. https://github.com/graphql/dataloader (accessed 2026-07-18).

* [[[react-2023]]] S. Yao, J. Zhao, D. Yu, N. Du, I. Shafran, K. R. Narasimhan, and Y. Cao. ReAct: Synergizing Reasoning and Acting in Language Models. _International Conference on Learning Representations_, 2023. https://openreview.net/forum?id=WE_vluYUL-X

* [[[toolformer-2023]]] T. Schick, J. Dwivedi-Yu, R. Dessì, R. Raileanu, M. Lomeli, L. Zettlemoyer, N. Cancedda, and T. Scialom. Toolformer: Language Models Can Teach Themselves to Use Tools. _Advances in Neural Information Processing Systems_ 36, 2023. https://arxiv.org/abs/2302.04761
```

## Suggested minimum citation set for the paper

If the paper needs a compact bibliography, retain these twelve anchors and add
project-specific evidence separately:

1. `chris-hicss-2026` — current ChRIS system description.
2. `cube-source` — exact CUBE resources and API behavior.
3. `pegasus-2015` — scientific workflow precedent.
4. `prov-dm` — canonical provenance model.
5. `unix-1974` — composition/pipeline lineage.
6. `fielding-rest` and `collection-json` — REST/hypermedia and the actual media type.
7. `evans-ddd` — Application Layer and Anti-Corruption Layer.
8. `jupyter-messaging` — kernel/frontend protocol precedent.
9. `rfc7426` and `kubernetes-controllers` — plane/controller vocabulary.
10. `young-cqrs` or `fowler-cqrs` — CQRS read projection vocabulary.
11. `rfc9110` and `rfc9111` — current HTTP semantics/caching.
12. `graphql-spec` and `graphql-nplus1` — GraphQL's scope and N+1 implementation risk.
