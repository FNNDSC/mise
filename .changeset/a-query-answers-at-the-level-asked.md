---
"@fnndsc/brasa": minor
---

brasa: `pacs query --series` answers one row per series (each carrying its study's columns) on the screen and in the CSV, and alone shows the series table. `--table` shows the answer's rows aligned: the CSV's columns, for a screen, nothing cut. `--csv --table` is refused by name (two formats for one screen); `--csv-to <path> --table` writes the CSV and shows the table. A flag the command does not know is refused by name instead of being dropped in silence. `--anon` is in the help.
