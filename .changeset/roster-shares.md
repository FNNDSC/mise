---
"@fnndsc/argus": minor
"@fnndsc/brasa": minor
---

feat: the roster shares, and a feed can be removed

`setfacl` grants to an identity and applies to a feed, so the feed roster is where sharing belongs — a browser row offers SHARE only because the path it holds names a feed.

The roster's rows learn the split the browser's already have: a click indicates, a double-click enters, and the action track is reserved on every row so a roster with verbs does not jump when one row starts speaking.

* **SHARE** asks who, and the question itself says a grant cannot be taken back. The irreversibility is stated where the grant is made rather than discovered afterwards, and because the sentence lives in the kernel's ask, every surface says it.
* Beside the verb, the row **reads back who already holds it** — a readout, not a verb: it says what the grant would be adding to.
* **DELETE** lowers to `feed rm`, which is new: the kernel could delete a feed but no shell verb could. It asks first by default, naming the feed and what goes with it, and takes `-f` for a caller that has already asked its own question.

`feed rm [<feed>] [-f]` joins the feed subcommands.
