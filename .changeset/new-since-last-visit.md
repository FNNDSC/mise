---
"@fnndsc/cumin": patch
"@fnndsc/salsa": patch
"@fnndsc/brasa": patch
"@fnndsc/menu": patch
"@fnndsc/argus": patch
---

A feed shared with you is marked NEW until you open it, across logins (#1065). RUNS leads with a NEW SINCE YOUR LAST VISIT block, each row marked with who shared it, and the bar counts them. Opening a feed takes its mark off, and CLEAR NEW takes them all. `proc feeds --new` lists them and `proc seen` clears them. Your own feeds and public feeds are never marked.
