---
"@fnndsc/brasa": minor
---

You can narrow a PACS answer to the series you want with grep. `query … | grep -i t1 | grep -vi gadavist` keeps the matching series with their study and patient, and every row keeps the handle it had, so `@SER241` still means the same series. What grep keeps becomes the listing `@SER` and `${listing}` refer to, so `| gather add` takes exactly that. It works on `ls` and `gather list` too, and with nothing piped it filters the last listing. grep takes its usual flags (-i -v -w -E -F -c -e); on plain text, or with any other flag, it is the system grep.
