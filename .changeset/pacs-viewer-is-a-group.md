---
"@fnndsc/argus": patch
---

A viewer opened from PACS is now its series' link group, not an anonymous loner. The PACS open path spawned the viewer with no host group, so the pane drawer could not reach it and a second IMAGE on the same series spawned a duplicate viewer. It now anchors the viewer's own group on the series it shows, so the group is that series' group: the drawer reaches it and a viewer already on stage for the same series is reused. A viewer opened from a pane that already has a group (a files row) is unchanged. Foundation for pane-group restoration.
