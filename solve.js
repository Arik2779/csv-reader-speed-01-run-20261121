// Fast drop-in for csv-reader 1.0.0 (make.fun's own CSV reader).
//
// Same observable behaviour as the reference: read the text once, left to
// right, and answer {columns, rows, errors} for {text, header}. Written from
// the rules, not from the reference's code: no character-at-a-time loop, no
// per-character string building.
//
// How it is faster
// ----------------
// * Unquoted fields are found with two native indexOf scans (',' and '\n')
//   and taken as one String slice; a stray CR is the only thing that takes
//   the slow path (a short scan of that one field's slice).
// * Quoted fields are found with one native indexOf scan per '"' and taken
//   as slices; doubled quotes and line breaks inside quotes take the slow
//   path only for that one field.
// * Error bookkeeping is O(1) per record: every error of a record carries
//   the line its record started on, so no per-character line tracking.
// * No regex, no split, no dependencies, no allocation per character.
//   UTF-16 code units are used throughout, exactly as the reference does,
//   so astral characters and lone surrogates survive unchanged.
//
// Field endings: 0 = comma, 1 = line break, 2 = end of text.

/** csv-reader 1.0.0's answer for one case's input, faster. */
export function run(input) {
  const text = String(input.text);
  const header = input.header === true;
  const len = text.length;
  const errors = [];
  const rows = [];
  let columns = null;
  let width = -1;

  let pos = 0; // the next character to read
  let line = 1; // the line that character is on
  if (text.charCodeAt(0) === 0xfeff) pos = 1;

  // The record being read: the line it starts on and the index in rows it
  // takes (null: the header). Every error of the record carries these.
  let recordLine = 1;
  let recordRow = null;

  function error(code) {
    errors.push({ code, line: recordLine, row: recordRow });
  }

  // Reads unquoted characters onto `init` up to the next comma or line
  // break: a CR not followed by LF is dropped (stray_cr). Returns the field
  // and how it ended; `added` counts the characters kept.
  function readUnquoted(init) {
    const initLen = init.length;
    const c = text.indexOf(',', pos);
    const n = text.indexOf('\n', pos);
    let end;
    let ended;
    if (c === -1 && n === -1) {
      end = len;
      ended = 2;
    } else if (n === -1 || (c !== -1 && c < n)) {
      end = c;
      ended = 0;
    } else {
      end = n;
      ended = 1;
    }
    // A CR just before the LF is the line break itself, not a stray CR.
    let contentEnd = end;
    if (ended === 1 && end > pos && text.charCodeAt(end - 1) === 13) contentEnd = end - 1;
    const seg = text.slice(pos, contentEnd);
    let value = init;
    if (seg.indexOf('\r') === -1) {
      value += seg;
    } else {
      // Slow path, rare: strip each lone CR (each is a stray_cr) and keep
      // the rest. Any CR here is lone: one followed by LF would have made
      // that LF the field's end (or the CRLF handled above).
      let s = 0;
      for (let i = 0; i < seg.length; i++) {
        if (seg.charCodeAt(i) === 13) {
          value += seg.slice(s, i);
          error('stray_cr');
          s = i + 1;
        }
      }
      value += seg.slice(s);
    }
    pos = ended === 2 ? len : end + 1;
    if (ended === 1) line += 1;
    return { value, ended, added: value.length - initLen };
  }

  // Reads a quoted field whose opening quote is at pos.
  function readQuoted() {
    const open = pos;
    const openLine = line;
    let value = '';
    let p = pos + 1;
    for (;;) {
      const q = text.indexOf('"', p);
      if (q === -1) {
        // The quote never closes: it is a literal character, and the text
        // after it is read again as unquoted.
        pos = open + 1;
        line = openLine;
        error('unterminated_quote');
        return readUnquoted('"');
      }
      const seg = text.slice(p, q);
      if (seg.indexOf('\n') === -1 && seg.indexOf('\r') === -1) {
        value += seg;
      } else {
        // Slow path, rare: each CRLF or lone CR inside the quotes reads
        // as one LF, and every one of them moves to the next line.
        let s = 0;
        for (let i = 0; i < seg.length; i++) {
          const cc = seg.charCodeAt(i);
          if (cc === 13) {
            value += seg.slice(s, i);
            value += '\n';
            line += 1;
            if (seg.charCodeAt(i + 1) === 10) i += 1;
            s = i + 1;
          } else if (cc === 10) {
            value += seg.slice(s, i);
            value += '\n';
            line += 1;
            s = i + 1;
          }
        }
        value += seg.slice(s);
      }
      if (text.charCodeAt(q + 1) === 34) {
        // A doubled quote is one quote inside the field.
        value += '"';
        p = q + 2;
        continue;
      }
      p = q + 1; // just past the closing quote
      if (p >= len) {
        pos = len;
        return { value, ended: 2 };
      }
      const cc = text.charCodeAt(p);
      if (cc === 44) {
        pos = p + 1;
        return { value, ended: 0 };
      }
      if (cc === 10) {
        pos = p + 1;
        line += 1;
        return { value, ended: 1 };
      }
      if (cc === 13 && text.charCodeAt(p + 1) === 10) {
        pos = p + 2;
        line += 1;
        return { value, ended: 1 };
      }
      // What follows the closing quote is appended as it stands, up to the
      // next comma or line break.
      pos = p;
      const junk = readUnquoted(value);
      if (junk.added > 0) error('quote_junk');
      return junk;
    }
  }

  for (;;) {
    // Lines with no characters are no records.
    while (pos < len) {
      const cc = text.charCodeAt(pos);
      if (cc === 10) {
        pos += 1;
        line += 1;
      } else if (cc === 13 && text.charCodeAt(pos + 1) === 10) {
        pos += 2;
        line += 1;
      } else {
        break;
      }
    }
    if (pos >= len) break;

    recordLine = line;
    recordRow = header && columns === null ? null : rows.length;
    const fields = [];
    let field;
    let quoted = false;
    do {
      quoted = text.charCodeAt(pos) === 34;
      field = quoted ? readQuoted() : readUnquoted('');
      fields.push(field.value);
    } while (field.ended === 0);

    // A line that held only stray CRs is left with no characters: no record
    // (its stray_cr errors stay).
    if (fields.length === 1 && fields[0] === '' && !quoted) continue;

    if (width < 0) width = fields.length;
    if (header && columns === null) {
      columns = fields;
      continue;
    }
    if (fields.length < width) {
      errors.push({ code: 'short_row', line: recordLine, row: recordRow, fields: fields.length });
      while (fields.length < width) fields.push('');
    } else if (fields.length > width) {
      errors.push({ code: 'long_row', line: recordLine, row: recordRow, extra: fields.splice(width) });
    }
    rows.push(fields);
  }
  return { columns: header ? (columns ?? []) : null, rows, errors };
}
