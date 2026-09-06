---
"argus": minor
---

feat(argus): a plugin is the one-node case, not a wall of text

`/bin` held two kinds of thing that behaved like two applications. A pipeline was a picture you could open; a plugin was prose you scrolled — the wall of scraped text the operator called exhausting.

A plugin is now the graph with one node in it, and there is no third rendering:

- **preview** — its card carries that node, drawn by the shared ranked layout a pipeline's card uses. It costs no fetch: a plugin is one node whatever it declares, where the card used to spend a `cat` per entry to print a paragraph.
- **detail** — the same stage with the same mode frame, so PULSE, RANKED/MOLECULE and 2D/3D act on it as on any graph.
- **immerse** — its node opens as its parameters, flag on the left and what the flag takes on the right, from the `plugin.info` model.

A pipeline node reads out the arguments an author already FIXED; a plugin reads out the ones nobody has fixed yet. One painter renders both, so the two readouts cannot drift.

**A view is closed by the operator, never by an arrival (#425).** Found live while proving this: opening a /bin entry fetches its graph into a mount, and a listing arriving a moment later replaced the whole view — the fetch then resolved onto a mount no longer in the page, and the stage stayed empty. A listing now lands under whatever is being read, and CLOSE or Esc shows it. The smoke scenario that slept three seconds to dodge that race no longer needs to.
