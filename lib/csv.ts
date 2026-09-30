export type ColumnType = "INTEGER" | "REAL" | "TEXT";

function detectDelimiter(text: string): string {
  // Look at the first line only, ignoring anything inside quotes.
  const counts: Record<string, number> = { ",": 0, ";": 0, "\t": 0 };
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '"') inQuotes = !inQuotes;
    else if (!inQuotes && (c === "\n" || c === "\r")) break;
    else if (!inQuotes && c in counts) counts[c]++;
  }
  let best = ",";
  for (const d of [";", "\t"]) {
    if (counts[d] > counts[best]) best = d;
  }
  return best;
}

/** Small RFC 4180-style parser: quoted fields, escaped quotes, CRLF, BOM. */
export function parseCsv(input: string): string[][] {
  const text = input.charCodeAt(0) === 0xfeff ? input.slice(1) : input;
  const delimiter = detectDelimiter(text);

  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const c = text[i];

    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += c;
      }
    } else if (c === '"' && field === "") {
      inQuotes = true;
    } else if (c === delimiter) {
      row.push(field);
      field = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(field);
      field = "";
      rows.push(row);
      row = [];
    } else {
      field += c;
    }
  }

  if (field !== "" || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  // Drop blank lines.
  return rows.filter((r) => !(r.length === 1 && r[0].trim() === ""));
}

/** Make a string safe to use as a table or column name. */
export function sanitizeIdentifier(raw: string, fallback: string): string {
  let name = raw
    .trim()
    .replace(/[^A-Za-z0-9_]+/g, "_")
    .replace(/^_+|_+$/g, "");
  if (!name) name = fallback;
  if (/^[0-9]/.test(name)) name = "_" + name;
  return name;
}

/** Ensure names are unique (case-insensitive), appending _2, _3, ... */
export function uniqueNames(names: string[], taken: Set<string> = new Set()): string[] {
  const used = new Set(Array.from(taken, (n) => n.toLowerCase()));
  return names.map((name) => {
    let candidate = name;
    let n = 2;
    while (used.has(candidate.toLowerCase())) {
      candidate = `${name}_${n++}`;
    }
    used.add(candidate.toLowerCase());
    return candidate;
  });
}

const INT_RE = /^-?\d+$/;
const REAL_RE = /^-?(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?$/;
const LEADING_ZERO_RE = /^-?0\d/; // zip codes, phone numbers, ids: keep as text

export function inferColumnTypes(dataRows: string[][], columnCount: number): ColumnType[] {
  const types: ColumnType[] = [];
  for (let col = 0; col < columnCount; col++) {
    let seen = false;
    let isInt = true;
    let isReal = true;

    for (const row of dataRows) {
      const v = (row[col] ?? "").trim();
      if (v === "") continue;
      seen = true;
      if (LEADING_ZERO_RE.test(v)) {
        isInt = false;
        isReal = false;
        break;
      }
      if (INT_RE.test(v) && v.length > 15) {
        // Too long to store exactly as a number (long ids, card-like numbers).
        isInt = false;
        isReal = false;
        break;
      }
      if (!INT_RE.test(v)) isInt = false;
      if (!REAL_RE.test(v)) isReal = false;
      if (!isInt && !isReal) break;
    }

    types.push(!seen ? "TEXT" : isInt ? "INTEGER" : isReal ? "REAL" : "TEXT");
  }
  return types;
}
