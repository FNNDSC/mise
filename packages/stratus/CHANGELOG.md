# @fnndsc/stratus

## 0.2.1

### Patch Changes

- Updated dependencies [f2180c1]
- Updated dependencies [c90b8a2]
- Updated dependencies [243aafa]
- Updated dependencies [0a52833]
  - @fnndsc/brasa@0.46.0
  - @fnndsc/calypso@0.26.1

## 0.2.0

### Minor Changes

- cd9c77e: A domain harbor-oci built can now be adopted and planned against from the session. `domain adopt <name> --from <checkout>` keeps its ids, spec, step evidence and secrets (mode 600, never served) with the domain's own state; with the `tasks` tier it also makes an OCI Resource Manager stack of Oracle's pinned `create-cluster-v1.6.1.zip`, tagged with the domain's name, and imports the Terraform state the checkout kept. `domain plan` with the tier then runs a plan job against that stack and reads the plan back as JSON, counting `Oracle-Tags` drift apart from real change. An adopted domain is never built on, and a domain kept here stands in for its checkout in the tree. Every Resource Manager job's log follows into the step's, and a stop cancels the job without forcing it.

  A plan's line counts a resource destroyed and made again as replaced, naming the kinds, so a re-plan of the live domain reads "0 to create, 21 to replace (loadbalancers), 0 to change and 24 Oracle-Tags drift, 0 to destroy". Adopting again finds the stack already tagged with the domain's name and takes it, rather than making a second. A Resource Manager log that cannot be read while the job writes it no longer fails the step: it is read again on the next poll.

- 4a2a561: A Trusted Domain can now be built on OCI from the session, and torn down. The build runs through Resource Manager and Red Hat's Assisted Installer, as harbor-oci proved it. `domain new --compartment` names where it goes. Preflight reads the credential, the compartment, the attribution tag, the room in each availability domain, the load balancers free, the zone's delegation and the SSH key, and refuses a spec with workers, since only the compact cluster is proven. The discovery image is copied into a private bucket and linked for a week; the link is kept as a secret. A new stack's variables come from the spec, the apply's outputs give the load balancers and the platform manifest, and the three A records are written in the zone. The installer takes a service account's token without a scope, fetches the pull secret each time, waits for every host to be known, and starts the install when the cluster is ready; the kubeconfig and the administrator's password are kept on the host. `domain teardown <name>` reads the cluster's own volumes, shows what goes, asks for the domain's name, then destroys the stack's resources and removes the records, the image and its link, those volumes and the installer's records; it refuses an adopted domain or one read from a checkout. New launch flags: --redhat-account and --ssh-key.
- 49ccdfd: The stratus prompt says where in the substrate a session stands: cloud, tenancy, region, user, domain, directory.

  The domain segment appears when the working directory is inside one.

  Sent as the wire's backend-neutral segments (docs/stratus.adoc, D9). Disconnected, the leader reads `OCI ✗` as an alert. The user is the identity as the cloud writes it, never shortened by the daemon; a surface short of room truncates it from the left.

- 14f8fc1: What each domain costs can now be read from the session: spend prices its machines, volumes and load balancers. Machines are priced by vCPU and memory while they run, volumes by size and performance, load balancers by the hour and their minimum bandwidth, as harbor-oci's burn did. Each line gives the rate an hour and what it has come to since the resource was made, then the domain's total; it is an estimate, not the bill. `domain status` carries the same cost in a line and in its model. The OCI driver now reads an instance's OCPUs and memory, a volume's performance units and a load balancer's minimum bandwidth, and the storage and balancer parts of Oracle's price list.
- 2a5a921: A Trusted Domain can now be made, priced and built from the session, over the fake cloud for now. `domain new <name>` writes a spec in `harbor-oci`'s shape and nothing else, kept with the domain's state under `$XDG_STATE_HOME/stratus/domains/<name>/`. `domain plan` reads only: the fit per availability domain, the hourly cost of compute and memory, where the steps stand; the infrastructure plan itself needs the `tasks` tier. `domain build` runs the steps (preflight to run) as a task, `/proc/steps/<name>-build`, written once over the cloud's build half and the installer; it stops before the first step that bills and asks, with the plan's counts and the cost, and refuses a plan that alters what exists. The build outlives every surface and a daemon restart, which picks it up from its first step not done. A built domain shows under `~` and in `domain status` beside those read from checkouts. A real cloud's build half comes with step 4b; `stratus --fake` builds over a fake cloud and installer on a clock.
- 5c90e5a: A domain built by harbor-oci shows under the session home; `domain status` says where each build step stands.

  `stratus --domain harbor=~/src/harbor-oci` puts `domains/harbor/` under the tenancy: `spec.yaml`, `settings` (no credentials), `state.json` (the ISO link's URL withheld), `steps/<nn-name>/` with each step's `state` and the `evidence` it rests on (`unknown` where the host keeps none), and `auth/`, whose files are refused with their host path. `domain status [<name>]` prints the same with the compartment's live resource counts; a verb that would start a host program is refused by name.

- 93fb6a4: A tenancy's instances, networks, load balancers, volumes, buckets and DNS zones list under each compartment.

  Every container level holds a kind folder per resource kind for the session's region, counted by one Resource Search. A resource is a folder of field files (`name id state region created tags info.json`, plus an instance's `shape zone ips`, a volume's `size attached`, a load balancer's `ip shape`); a network nests `subnets/` and `securitygroups/`; a bucket shows `links` and its `objects/` as files (small ones readable); a DNS zone shows `records/`, a file per name. `ls -l` marks each kind and shows its lifecycle state, coloured. Duplicate names wear `~<id6>`, answers are cached a minute.

- dcdc6cd: A stratus dashboard shows DOMAINS (each domain's last build step) and CAPACITY (what each zone has free).

  DOMAINS reads `domain status` and CAPACITY reads the new `capacity` command, through the wire's new `stratus.domains` and `stratus.capacity` models (menu). `capacity [<family>…]` lists, for the shape families named or those the domains' specs name, each limit their shapes draw on per zone, permitted and free; a shape now names its limit service. A domain with a step gone wrong shows in red.

- 0778c63: A domain's cluster can now be verified from the session, by harbor-oci's ten checks, without `oc` or `dig`. Its ten checks are the API's `/readyz`, the cluster version, nodes Ready, the OCI cloud controller (providerIDs, shapes, zones), operators settled, the default storage class, the three DNS records from a public resolver, the console over the router's CA, CPU headroom for a plugin job, and a block-volume probe. Nine only read; the probe makes a 50 GiB claim and a pod and deletes them, so it runs only under the `tasks` tier and otherwise says so. The kubeconfig is read on the host and never leaves it. The result is kept as the domain's verify step, so `domain status` and the DOMAINS tile show it. Adoption now keeps the load balancers' addresses from the state's outputs. A `--fake` daemon verifies against a fake healthy cluster.

### Patch Changes

- 49501d4: stratus now takes --host-control tasks with a space as well as with an equals sign, and its usage names the tasks tier.
- 1037628: A domain's verify, plan and build are refused as verbs not yet written, no longer as host programs. The build steps become the driver's own code, with Terraform run through OCI Resource Manager; harbor-oci is the specification they are ported from, never a program stratus runs (docs/stratus.adoc, D3).
- Updated dependencies [0388f12]
- Updated dependencies [01fcb59]
- Updated dependencies [49ccdfd]
- Updated dependencies [49501d4]
- Updated dependencies [49501d4]
- Updated dependencies [49501d4]
- Updated dependencies [14f8fc1]
- Updated dependencies [2a5a921]
- Updated dependencies [dcdc6cd]
  - @fnndsc/calypso@0.26.0
  - @fnndsc/brasa@0.45.0
  - @fnndsc/fond@0.5.1
  - @fnndsc/menu@0.28.0

## 0.1.0

### Minor Changes

- 1e637f1: stratus: a session over the cloud substrate a Trusted Domain runs on, reading a tenancy.

  The first slice of docs/stratus.adoc: one backend, clouds as drivers. The package holds the driver interface, a fake cloud that runs the driver contract, and the OCI driver over Oracle's SDK (identity, compartments, regions, availability domains, limits, shapes, list prices). A session mounts its tenancy under /net/oci/<tenancy>/: compartments nest as the cloud nests them, a duplicate name wears ~<id6> and the plain name refuses, regions/ holds each region's zones, limits, shapes and prices as folders of field files, domains/ is the home. Every answer is kept for a minute. The stratus command hosts the session as a calypso daemon on the bastion; --fake hosts the fake cloud. CI boots it with no ChRIS package loaded and a ratchet keeps oci-\* imports inside the OCI driver.

### Patch Changes

- Updated dependencies [1e637f1]
  - @fnndsc/fond@0.5.0
  - @fnndsc/brasa@0.44.1
