---
'@fnndsc/salsa': minor
'@fnndsc/brasa': patch
---

A dropped retrieve watch is no longer reported as a failed pull.

Pulling a 22-series study reported `0/22 series complete` with every series
marked `ERROR` — and the CUBE path report printed immediately below it listed
four of those same series with real paths and file counts. The retrieves were
fine; the watch had died.

One websocket failure marked every in-flight series `error`, because
`RetrieveStatus` had no value meaning *the client stopped watching and does not
know the outcome*. The code knew the difference — a comment in `pull` says a
watch failure "is usually cosmetic, the PACS keeps pushing and CUBE keeps
registering after detach" — but nothing downstream acted on it.

A lost watch now marks its series `unconfirmed`. The confirmation loop, which
already asks CUBE about series whose confirmation went missing, now asks about
these too: a series CUBE reports as stored is `pulled`, with its file count and
path, whatever the watch managed to see.

What remains unconfirmed is reported as unknown rather than lost — `? … [WATCH
ENDED — may still be arriving]` — and does not fail the command, because
nothing in the client knows that it failed. A series that was never fired is
still a real failure and still fails the command.
