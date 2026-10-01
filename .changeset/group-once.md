---
"@fnndsc/cumin": patch
---

A group's members are read off its membership page: a membership row names its user (`user_id`, `user_username`), so `members_getAll` no longer fetches every member one by one — the boot's group warm asked CUBE for 51 users one by one on the dev CUBE and now asks for none; the linked user is fetched only for a row that does not name one. And the group items the one groups listing served are kept per client, so a group's members are read off its item instead of listing the group by id first (73 searches on a 73-group CUBE).
