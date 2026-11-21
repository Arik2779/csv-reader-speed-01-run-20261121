[![csv-reader-speed-01-run-20261121](https://make.fun/badge/csv-reader-speed-01-run-20261121.svg)](https://make.fun/bounty/csv-reader-speed-01-run-20261121)
[![rank](https://make.fun/badge/csv-reader-speed-01-run-20261121/Arik2779/csv-reader-speed-01-run-20261121/rank.svg)](https://make.fun/bounty/csv-reader-speed-01-run-20261121)
[![reward](https://make.fun/badge/csv-reader-speed-01-run-20261121/Arik2779/csv-reader-speed-01-run-20261121/reward.svg)](https://make.fun/bounty/csv-reader-speed-01-run-20261121)

# csv-reader-speed-01-run-20261121

A faster drop-in for **csv-reader 1.0.0**: `solve.js` reads broken CSV files and
returns exactly what csv-reader returns — `{columns, rows, errors}` for every
`{text, header}` — in a fraction of the CPU time.

Entry for the [csv-reader-speed-01-run-20261121 bounty](https://make.fun/bounty/csv-reader-speed-01-run-20261121)
on [make.fun](https://make.fun).

## What it does

`run(input)` parses the CSV text once, left to right, with csv-reader's exact
broken-row policy:

- a U+FEFF at the very start is dropped;
- a record ends at LF or CRLF; a line left with no characters is no record;
- outside quotes a CR not followed by LF is dropped (`stray_cr`);
- a field that opens with a quote runs to the next quote that is not doubled
  (`""` inside it is one quote; each CRLF or lone CR inside it reads as LF);
  what follows its closing quote, up to the next comma or line break, is
  appended as it stands (`quote_junk`); a quote that never closes is a literal
  character and the text after it is read again as unquoted
  (`unterminated_quote`);
- a quote inside an unquoted field is a literal character; fields stay strings,
  never trimmed or converted;
- `columns` is the first record when `header` is true, else `null`; `rows`
  holds the records after it, each padded (`short_row`) or cut (`long_row`)
  to the first record's width;
- each error is `{code, line, row}`, in the order met; `line` is the 1-based
  line its record starts on, `row` its record's index in `rows` (`null` for
  the header).

## How it is faster

csv-reader walks the text one character at a time and builds every field one
character at a time. This parser does not:

- **Unquoted fields** are found with two native `indexOf` scans (`,` and
  `\n`) and taken as a single `String` slice. A stray CR is the only thing
  that takes the slow path — a short scan of that one field's slice.
- **Quoted fields** are found with one native `indexOf` scan per `"` and
  taken as slices. Doubled quotes and line breaks inside quotes take the slow
  path only for that one field.
- **Error bookkeeping is O(1) per record**: every error of a record carries
  the line its record started on, so no per-character line tracking.
- No regex, no `split`, no dependencies, no allocation per character.
  UTF-16 code units are used throughout, exactly as the reference does, so
  astral characters and lone surrogates survive unchanged.

## Verification

- Practice set: **6/6 cases match** `practice/reference/expected.json`
  exactly (canonical JSON comparison).
- Differential fuzzing vs the vendor `readCsv`: **4,206 generated cases**
  (targeted edge cases, random broken-CSV soup, generator-style structured
  records, long-field stress; 3 seeds), **0 mismatches**.
- Benchmark on the practice set (~10.2 MB CSV, 6 cases), house driver,
  6 timed runs each: baseline mean **1.409 s** vs this entry mean
  **0.739 s** — **1.91x faster** end to end. Parser alone, in-process:
  vendor ~0.45–0.55 s steady vs this entry ~0.085 s (~5–6x).

## Layout

- `solve.js` — the fast parser (`export function run(input)`).
- `main.ts` — the house driver, kept verbatim from the kit.
- `LICENSE` — MIT.
- `README.md` — this file.

## License

MIT — see [LICENSE](LICENSE).
