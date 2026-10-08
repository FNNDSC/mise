/**
 * @file The ChRIS session's filesystem: fond's dispatcher with CUBE's mounts.
 *
 * fond's `VFSDispatcher` routes a path to the mount that owns it and knows no
 * backend. `CubeVfsDispatcher` registers the ChRIS backend's mounts on it, in
 * an order that matters only for equal-length prefixes (the sort is stable):
 * PACS, `/etc`, the three `/proc` relations, and `/usr/share`. Everything no
 * mount claims is a CUBE file, through the native provider. The engine adds
 * its own static mounts (`/bin`, `/usr`, …) to the shared instance.
 *
 * @module
 */

import { VFSDispatcher } from "@fnndsc/fond";
import { NativeVfsProvider } from "./providers/native.js";
import { PacsVfsProvider } from "./providers/pacs.js";
import { EtcVfsProvider } from "./providers/etc.js";
import { ProcVfsProvider } from "./providers/proc.js";
import { WorkflowsVfsProvider } from "./providers/workflows.js";
import { ProcTagsVfsProvider } from "./providers/procTags.js";
import { ShareVfsProvider } from "./providers/share.js";

export { VFSDispatcher } from "@fnndsc/fond";

/**
 * fond's dispatcher with the ChRIS backend's mounts registered, and CUBE's
 * files as the fallback.
 */
export class CubeVfsDispatcher extends VFSDispatcher {
  constructor() {
    super(new NativeVfsProvider());
    this.provider_register(new PacsVfsProvider());
    this.provider_register(new EtcVfsProvider());
    this.provider_register(new ProcVfsProvider());
    // Three relations CUBE owns: the tags a feed can carry, the runs a
    // pipeline produced, and what is known about a plugin as opposed to how
    // to invoke it.
    this.provider_register(new WorkflowsVfsProvider());
    this.provider_register(new ProcTagsVfsProvider());
    this.provider_register(new ShareVfsProvider());
  }
}

/** The session's one filesystem dispatcher. */
export const vfsDispatcher: CubeVfsDispatcher = new CubeVfsDispatcher();
