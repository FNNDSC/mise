# @fnndsc/stratus

A mise session over the cloud substrate a Trusted Domain runs on. One backend, clouds as drivers; Oracle Cloud Infrastructure is the first driver. The design is [`docs/stratus.adoc`](../../docs/stratus.adoc).

A stratus session is outside any ChRIS. It mounts a cloud tenancy under `/net/<cloud>/<tenancy>/` and lets the mise shell walk it: compartments nest as the cloud nests them, `regions/<region>/` holds each region's zones, limits, shapes and prices as folders of field files, and `domains/` is where Trusted Domains are built. Every row is a folder or a file to the shell; `ls -l` draws a compartment as a compartment and colours it by state.

## Running

The `stratus` command hosts the session as a calypso daemon on the bastion, the host that holds the cloud credential:

```
stratus                          # the DEFAULT profile of ~/.oci/config, its home region
stratus --profile BCH --region us-phoenix-1
stratus --fake                   # a session over the fake cloud, for tests
stratus --fake --host-control tasks
                                 # one that may build domains over the fake cloud
```

A domain is made, priced and built with `domain new`, `domain plan` and `domain build`. The build runs as a task (`/proc/steps/<name>-build`) that outlives every surface and a daemon restart; `wait` follows it, `kill` asks it to stop. Starting it needs the `tasks` tier, and before the first step that bills it asks, with the cost. Over the fake cloud the build moves on a clock (`STRATUS_FAKE_TICK_MS`, 700 by default). `domain adopt <name> --from <harbor-oci checkout>` keeps a domain built elsewhere and, with the tier, takes its stack and Terraform state into OCI Resource Manager, where `domain plan` plans against it; an adopted domain is never built on. `domain verify` runs `harbor-oci`'s ten checks against a domain's cluster through its kubeconfig (`src/cluster/`, `src/domain/verify.ts`); the block-volume probe, which writes, needs the tier. `spend` prices each domain's machines, volumes and load balancers at list price (`src/domain/spend.ts`).

Attach with `chell --remote`, or open the ARGUS address the daemon prints. A credential that does not work still starts the daemon, disconnected, with `/net/oci` empty.

## Shape

- `src/cloud/driver.ts` is the `CloudDriver` interface: identity, containers, regions, zones, limits, shapes, prices, each answered for the region given.
- `src/cloud/oci/` is the OCI driver over Oracle's TypeScript SDK (`api.ts` wraps the few calls made, `prices.ts` reads Oracle's public price list), and its build half over Resource Manager (`builder.ts`, `rmApi.ts`; `planRead.ts` reads a plan's JSON, drift apart). Only this folder may import an `oci-*` package: `npm run lint:stratus-deps` at the repository root keeps it so.
- `src/cloud/fake/` is an in-memory cloud. It runs the same driver contract (`tests/support/driverContract.ts`) the OCI driver runs over recorded answers, and it is what the boot proof hosts.
- `src/vfs/tenancy.ts` is the tree, a fond provider over the driver; `src/vfs/look.ts` is how its rows show.
- `src/domain/` is a domain built here: its spec (`spec.ts`, `harbor-oci`'s `spec.yaml` shape), its state on the host (`state.ts`, `$XDG_STATE_HOME/stratus/domains/<name>/`), its fit and cost (`sizing.ts`), and its steps (`steps.ts`), written once over the cloud's build half (`src/cloud/builder.ts`) and the installer (`src/installer/`). `src/cloud/fake/builder.ts` is the fake of both.
- `src/session.ts` is who the session is (`user@tenancy`), where it starts (`domains/`) and where it left off; `src/backend.ts` is the descriptor `engine_create` takes.

## Proving it

```
npm test                         # the unit suites
npm run test:boot                # boots over the fake cloud with no ChRIS package loaded
```

The boot proof walks the tree through the engine (`ls`, `cd`, `cat`, a pipe) and fails if cumin, salsa or chili is ever asked for.
