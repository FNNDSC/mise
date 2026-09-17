---
"@fnndsc/brasa": patch
---

Kernel: a DICOM address is followed to the bytes behind it.

A `pl-dircopy` of a PACS pull does not copy the files: its output folder is a link, and the DICOM under it is stored beneath `/SERVICES/PACS`. `dcm series` and `dcm tags` resolved the path they were given against the cwd and stopped there, so the logical name matched no file id and every slice of a pulled series was unreadable from the feed it was pulled into. The listing showed the files; nothing could open one. The same series read fine at its PACS address, and `cd` into the folder — which does follow links — made the very same command work on the very same file.

Both commands now resolve the address the rest of the file verbs already do: a projection through the provider that owns it, then the link walk. `file_read`, the door behind the browser's byte route, follows a node's data link the same way when the folder it lands on is itself a link. Resolution is best effort, so a path that resolves no further stands as it was and the command still refuses by its own name.
