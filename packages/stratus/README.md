# @fnndsc/stratus

A mise session over the cloud substrate a Trusted Domain runs on. One backend, clouds as drivers; Oracle Cloud Infrastructure is the first driver. The design is [`docs/stratus.adoc`](../../docs/stratus.adoc).

A stratus session is outside any ChRIS. It mounts a cloud tenancy under `/net/<cloud>/<tenancy>/` and lets the mise shell walk it: compartments nest as the cloud nests them, `regions/<region>/` holds each region's zones, limits, shapes and prices as folders of field files, and `domains/` is where Trusted Domains are built. Every row is a folder or a file to the shell; `ls -l` draws a compartment as a compartment and colours it by state.

## Running

The `stratus` command hosts the session as a calypso daemon on the bastion, the host that holds the cloud credential:

```
stratus                          # the DEFAULT profile of ~/.oci/config, its home region
stratus --profile BCH --region us-phoenix-1
stratus --fake                   # a session over the fake cloud, for tests
```

Attach with `chell --remote`, or open the ARGUS address the daemon prints. A credential that does not work still starts the daemon, disconnected, with `/net/oci` empty.

## Shape

- `src/cloud/driver.ts` is the `CloudDriver` interface: identity, containers, regions, zones, limits, shapes, prices, each answered for the region given.
- `src/cloud/oci/` is the OCI driver over Oracle's TypeScript SDK (`api.ts` wraps the few calls made, `prices.ts` reads Oracle's public price list). Only this folder may import an `oci-*` package: `npm run lint:stratus-deps` at the repository root keeps it so.
- `src/cloud/fake/` is an in-memory cloud. It runs the same driver contract (`tests/support/driverContract.ts`) the OCI driver runs over recorded answers, and it is what the boot proof hosts.
- `src/vfs/tenancy.ts` is the tree, a fond provider over the driver; `src/vfs/look.ts` is how its rows show.
- `src/session.ts` is who the session is (`user@tenancy`), where it starts (`domains/`) and where it left off; `src/backend.ts` is the descriptor `engine_create` takes.

## Proving it

```
npm test                         # the unit suites
npm run test:boot                # boots over the fake cloud with no ChRIS package loaded
```

The boot proof walks the tree through the engine (`ls`, `cd`, `cat`, a pipe) and fails if cumin, salsa or chili is ever asked for.
