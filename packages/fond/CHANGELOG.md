# @fnndsc/fond

## 0.2.0

### Minor Changes

- e1deb53: Nothing changes for chell, ARGUS or porter users: the virtual filesystem's contracts and dispatcher now live in fond. fond's dispatcher knows no backend; salsa's CubeVfsDispatcher registers CUBE's mounts on it in the same order, so every path routes as before.

### Patch Changes

- 5bb17f6: Nothing changes for chell, ARGUS or porter users: a listing entry's shape now belongs to menu, with an open type. `ListingItem` and `listingItemSchema` are menu's, so a backend can list its own kinds beside `dir`, `file`, `link` and `vfs`; fond's `VFSItem.type` opens the same way, and chili re-exports the type.

## 0.1.2

### Patch Changes

- b0d414b: fond's README and description now say what fond is, not where the backend-neutral work stands. fond holds the pieces every layer needs, whatever the backend; status lines would have gone stale.

## 0.1.1

### Patch Changes

- 803a423: fond's README now says what the package is for and how to use it, with examples of Result and the error stack. It also explains why the stack is one shared instance and where fond sits in the stack.
