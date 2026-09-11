# The canon

`lcars.json` and `pharos.json` are what ARGUS **looks like**, recorded as the
computed style of every chrome element — 276 elements, 55 properties each.

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

## What the fingerprint cannot see

`getComputedStyle(el)` is called on elements only, so **pseudo-elements are
invisible to it**. Every `::before` and `::after` in the frame — masks, lit
bands, the lens rings, the elbow's black corner — can be wrong, or missing
entirely, while the diff still reports zero.

That is not hypothetical. The clean-room rebuild dropped the black mask behind
FILES-01's swept corner, so the gutter's own colour showed through the sweep
and the elbow read as an arc painted on a rectangle. Both canons scored zero
differences the whole time; the defect was found by looking at the surface.

The same blind spot covers anything a theme never declares: LOWER DECKS is the
*absence* of `data-theme`, and a property no rule sets resolves to nothing
rather than to a difference.

**So the gate is necessary, not sufficient.** Look at the frame in every theme
after changing it, and treat a zero-difference diff as evidence that nothing
*watched* moved — not as evidence that the frame is right.
