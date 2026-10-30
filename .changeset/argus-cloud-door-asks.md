---
"@fnndsc/argus": minor
---

Entering cloud management asks READ or MANAGE at the door, on the dashboard and in the console alike; the `--spend` flag is gone.

Whether a stratus session may act on the tenancy (build, tear down, spend) is fixed when porter starts it, and it used to be asked for with `stratus oci --spend`: a flag no control on the surface could reach, and a word nobody would know to type. Now bare `stratus oci` asks on a sheet, the way trek asks its settings before the first turn: READ (look only; nothing outside this host changes) or MANAGE (act as well, each act after its own lock and the name typed back), with NOT NOW. `stratus oci read` and `stratus oci manage` answer in words. The ChRIS dashboard gains a CLOUD tile where the page came through a porter; it runs the same line, so the question is one question pressed or typed. `--spend` and `--read` are refused by name.
