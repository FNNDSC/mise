---
"@fnndsc/salsa": patch
---

salsa: a new feed's output path belongs to the feed's owner, not the input's.

Rooting a feed on data somebody else owns — a PACS retrieve lives under `/SERVICES/PACS/<server>/…` — predicted an output path of `/home/PACS/feeds/feed_N/…`, because the owner was read off the third segment of the INPUT path. The feed itself sat in the caller's own home, so the predicted folder was one nobody could list, and anything that followed the prediction looked at nothing.

The owner now comes from the created feed, falling back to the old reading only when CUBE does not say. Found by a manifest that anonymized a PACS series and then asked what it had produced.
