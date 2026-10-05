/**
 * @file What the acronyms around here mean: the book `wtf` reads from.
 *
 * BSD's `wtf` read /usr/share/misc/acronyms. Ours reads this: the ChRIS and
 * DICOM words a new user meets in their first hour, and the names of the
 * mise packages. Keys are matched without regard to case; a key may have
 * several meanings, each its own line.
 *
 * @module
 */

/** The book: a term to its meanings. */
export const ACRONYMS: Readonly<Record<string, ReadonlyArray<string>>> = {
  chris: ['ChRIS — the ChRIS Research Integration System: a platform that runs containerised analyses (plugins) on medical data, by the FNNDSC at Boston Children\'s Hospital'],
  cube: ['CUBE — the ChRIS Ultron Back End: the REST API and database every ChRIS surface talks to (a Django app)'],
  fnndsc: ['FNNDSC — the Fetal-Neonatal Neuroimaging and Developmental Science Center, Boston Children\'s Hospital; ChRIS\'s home'],
  feed: ['feed — one analysis in ChRIS: a tree of plugin instances rooted on some data; what ARGUS lists under ANALYSES'],
  plugin: ['plugin — a containerised program ChRIS can run; a step in a feed. Kinds: fs (makes data from nothing), ds (data in, data out), ts (joins several parents)'],
  pipeline: ['pipeline — a saved shape of plugins to run in order, with their parameters; what `pipeline run` starts and `/bin` lists'],
  instance: ['plugin instance — one run of a plugin inside a feed, with its own parameters, status and output folder; a job'],
  job: ['job — a plugin instance, as `proc` and the dashboard count them'],
  cfs: ['CFS — the ChRIS filesystem: the files CUBE holds, under /home/<user>, /SERVICES/PACS, /PIPELINES, /SHARED and /PUBLIC'],
  swift: ['Swift — the object store CUBE kept files in originally; the paths in CFS still look like it'],
  pfcon: ['pfcon — the process-and-file controller: the service CUBE hands a plugin run to, which stages the data and starts the container'],
  pman: ['pman — the process manager behind pfcon: starts containers on a compute (Docker, Swarm, Kubernetes, Slurm)'],
  pfdcm: ['pfdcm — the PACS front end: the service that asks a PACS (C-FIND) and tells it to send (C-MOVE); `pacs query` and `pull` go through it'],
  oxidicom: ['oxidicom — the DICOM receiver (in Rust) that the PACS sends files to; it stores them and registers them in CUBE, and reports progress over LONK'],
  lonk: ['LONK — Light Oxidicom NotifiKations: the small messages oxidicom publishes (over NATS) as a series arrives: a file count, done, or an error'],
  nats: ['NATS — the message bus oxidicom publishes LONK on; CUBE relays it to a websocket a pull watches'],
  pacs: ['PACS — Picture Archiving and Communication System: the hospital\'s image archive, spoken to in DICOM'],
  dicom: ['DICOM — Digital Imaging and Communications in Medicine: the file format and the network protocol of medical imaging'],
  'c-find': ['C-FIND — the DICOM query: ask a PACS what it holds (`pacs query`)'],
  'c-move': ['C-MOVE — the DICOM retrieve: tell a PACS to send a study or series to a receiver (`pull`, with oxidicom receiving)'],
  'c-store': ['C-STORE — the DICOM send: one image delivered to a receiver; what a C-MOVE sets off, many times'],
  ae: ['AE title — Application Entity title: the name a DICOM node goes by on the network (the receiver here is an AE title the PACS knows)'],
  aetitle: ['AE title — Application Entity title: the name a DICOM node goes by on the network'],
  mrn: ['MRN — Medical Record Number: the hospital\'s patient identifier; PatientID in DICOM'],
  accession: ['accession number — the identifier of one imaging order/study at the hospital; AccessionNumber in DICOM'],
  study: ['study — one imaging visit in DICOM, holding series'],
  series: ['series — one acquisition in a study: a stack of images of one kind (an axial T1, say); what `pull` fetches'],
  sop: ['SOP — Service-Object Pair: DICOM\'s name for a kind of object (an MR image) and the services on it; a SOPInstanceUID names one image'],
  uid: ['UID — a DICOM unique identifier (dotted numbers): StudyInstanceUID, SeriesInstanceUID, SOPInstanceUID'],
  modality: ['modality — the kind of scanner: MR, CT, US, CR, DX, PT …'],
  mpr: ['MPR — multiplanar reconstruction: a volume resliced into other planes'],
  sr: ['SR — Structured Report: a DICOM document rather than an image (a radiology report); a PACS will often not send these'],
  hu: ['HU — Hounsfield unit: CT intensity, water at 0, air at −1000'],
  nifti: ['NIfTI — the neuroimaging volume format (.nii, .nii.gz) most analysis tools read; what DICOM gets converted to'],
  bids: ['BIDS — the Brain Imaging Data Structure: a folder and naming convention for neuroimaging datasets'],
  freesurfer: ['FreeSurfer — the brain MRI analysis suite (cortical surfaces, segmentations) many ChRIS plugins wrap'],
  seagap: ['SeaGaP — Search, Gather, Process: the ChRIS workflow ARGUS is built around — find data, gather a cohort, run a pipeline on it'],
  cohort: ['cohort — the set of series or files gathered to process together; GATHER in ARGUS; kept in ~/gather'],
  mise: ['mise — this framework: an intent kernel (brasa) with surfaces (chell, ARGUS); the name is "mise en place"'],
  brasa: ['brasa — the intent kernel: every command\'s meaning, returning typed envelopes; knows no surface'],
  chell: ['chell — the terminal surface: a shell over brasa; also the program that starts a daemon'],
  calypso: ['CALYPSO — the daemon: one session many surfaces attach to over a websocket; Accepts Language, Yielding Permitted Shell Operations'],
  argus: ['ARGUS — the browser surface: panes over the same session, drawn in LCARS'],
  porter: ['porter — the display manager: the door (login) that starts or finds a user\'s daemon and serves ARGUS behind it'],
  menu: ['menu — the wire package: the message and model schemas every surface and the daemon agree on'],
  cumin: ['cumin — the base library: the CUBE client, connection, caches and the error stack'],
  salsa: ['salsa — the data layer: files, feeds, the virtual filesystem providers, the retrieve watch'],
  chili: ['chili — the older command layer: the path mapper and the commands brasa still delegates to'],
  orrery: ['orrery — the scene package: molecules, galaxies and the universe, drawn for ARGUS'],
  envelope: ['envelope — what a command returns: rendered text, a status, and a typed model a surface may draw'],
  lcars: ['LCARS — Library Computer Access/Retrieval System: the Star Trek interface ARGUS\'s look is after'],
  aegis: ['AEGIS — ARGUS\'s interface standard: the laws every pane obeys, in apps/argus/docs/aegis.adoc'],
  harbor: ['HARBOR — the project board the mise epics are tracked on'],
  k8s: ['k8s — Kubernetes, which runs CUBE and its services here'],
  oidc: ['OIDC — OpenID Connect; how the mise packages publish to npm without a token'],
  wtf: ['wtf — this: BSD\'s acronym expander, with this book instead of /usr/share/misc/acronyms'],
};
