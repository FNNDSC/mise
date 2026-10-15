---
"@fnndsc/brasa": minor
---

You can now see which number to type. A PACS answer, `query --table`, `gather list` and `ls -l` print each row's handle (`@PAT1`, `@STD3`, `@SER12`, `@DIR4`) beside it, short and aligned, and end with a footer saying what is numbered (`numbered: @PAT1, @STD1-20, @SER1-299`). What is printed is what `gather add @SER12` expands to. `help pronouns` explains the `${…}` pronouns, and a handle that names nothing in the current listing says what the listing holds.
