---
"@fnndsc/argus": patch
---

argus: a page older than the build its server now has says so. When a tab loaded before a deploy asks for an on-demand chunk the server no longer has (the image engines load this way), argus writes one console line and shows a notice over the stage, "ARGUS WAS UPDATED ON THE SERVER — THIS PAGE IS OLDER", with RELOAD. It used to fail silently: an image pane never opened.
