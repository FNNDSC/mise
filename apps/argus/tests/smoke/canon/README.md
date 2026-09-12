# The canon

`lcars.json` and `pharos.json` are what ARGUS **looks like**, recorded as the
computed style of every chrome element **and of both boxes it can draw without
owning a node** — 285 records, 71 properties each.

They exist because the operator settled it: *"the current look-n-feel of ARGUS,
i.e. its re-implementation of theLCARS.com is our canon. That is our look."*
ARGUS's frame has drifted from the template it started in — the left gutter is
168px where TheLCARS.com sets 240px — and that drift is a design, not an
accident. This is the design, written down.

## Using it

```bash
node tests/smoke/themeSnapshot.mjs /tmp/now.json            # LCARS, the default
node tests/smoke/themeSnapshot.mjs /tmp/now-pharos.json pharos
node tests/smoke/themeSnapshot.mjs --diff tests/smoke/canon/lcars.json /tmp/now.json
```

Zero differences is the gate for any change that touches the frame. A difference
is printed down to the element and the property, so a regression names itself.

## What is deliberately not in here

The console transcript and the listing rows are **content**: they differ run to
run because the session did different things, and a fingerprint that moves on
its own proves nothing. The latency readout is excluded for the same reason —
it is present only once a reading has landed.

## Re-recording

Only when a change to the frame is **intended**. Re-record both themes, and say
in the same commit what moved and why — the point of a baseline is that it does
not quietly follow the code.

## What it took to make it honest

The first cut of this fingerprint read elements only, and called
`getComputedStyle(el)` with no second argument. Every `::before` and `::after`
in the frame was therefore invisible to it: masks, fillets, spurs, lit bands,
the lens rings. That is not a theoretical gap. The clean-room rebuild dropped
**seven** pseudo-elements — the mask behind FILES-01's swept corner, the inner
elbow of the header pane and of the body pane (two each), and the spur and bite
on the long block of both bands — and both canons scored zero differences the
entire time. Three of the seven were found by eye, by an operator looking at
the surface; the other four were found the moment the fingerprint was widened
to see them.

Two other things had to change before the widened record could be trusted:

* **Every clock is stopped first.** A `*, *::before, *::after { animation: none;
  transition: none }` sheet goes in before the snapshot. The chrome breathes,
  so `filter` is a function of when the snapshot lands: the same build read
  12 to 31 differing pixels against itself, and two builds of identical CSS read
  245 to 390, purely on animation phase.
* **The properties that draw the shapes are watched.** The original 55 carried
  no `background-image` (the elbow's fillet is one), no `clip-path` (PHAROS cuts
  every stone with it), no `mask-image` (the nameplate is one), no `content`
  (which is what says a pseudo-element is there at all), and no `filter`.
  A url() has its origin stripped, since the daemon's port is not a look.

## What is deliberately not in here

The console transcript and the listing rows are **content**: they differ run to
run because the session did different things, and a fingerprint that moves on
its own proves nothing. The latency readout is excluded for the same reason —
it is present only once a reading has landed.

## Re-recording

Only when a change to the frame is **intended**. Re-record both themes, and say
in the same commit what moved and why — the point of a baseline is that it does
not quietly follow the code.

## Still not sufficient

The gate now sees far more, and it still cannot see everything: it reads one
viewport, one session state, and the panes that happen to be on stage. Cycle
every scheme with the console shut and look at the frame before landing a change
to it. The fingerprint is what catches the rest.
