import { SEED_SQL } from "./schema";
import type { SqlDatabase, SqlJsStatic, SqlValue } from "./sqljs";
import {
  inferColumnTypes,
  parseCsv,
  sanitizeIdentifier,
  uniqueNames,
} from "./csv";
import { validateReadOnlySql } from "./sqlGuard";

export const MAX_SQLITE_BYTES = 50 * 1024 * 1024;
export const MAX_CSV_BYTES = 25 * 1024 * 1024;
export const MAX_RESULT_ROWS = 500;

const quoteIdent = (name: string) => `"${name.replace(/"/g, '""')}"`;

/* ---------- building databases ---------- */

export function createSampleDb(SQL: SqlJsStatic): SqlDatabase {
  const db = new SQL.Database();
  db.run(SEED_SQL);
  lockReadOnly(db);
  return db;
}

const SQLITE_MAGIC = "SQLite format 3\u0000";

export function openSqliteFile(SQL: SqlJsStatic, bytes: Uint8Array): SqlDatabase {
  const header = new TextDecoder("latin1").decode(bytes.slice(0, 16));
  if (header !== SQLITE_MAGIC) {
    throw new Error("That file isn't a valid SQLite database.");
  }
  const db = new SQL.Database(bytes);
  try {
    db.exec("SELECT count(*) FROM sqlite_master");
  } catch {
    db.close();
    throw new Error("Couldn't read that SQLite file. It may be corrupted or encrypted.");
  }
  lockReadOnly(db);
  return db;
}

/** Adds one CSV file to `db` as a new table and returns the table name. */
export function importCsv(db: SqlDatabase, fileName: string, text: string): string {
  const rows = parseCsv(text);
  if (rows.length === 0) throw new Error(`${fileName} is empty.`);

  const [headerRow, ...dataRows] = rows;
  const columnCount = headerRow.length;

  const existing = new Set<string>();
  for (const t of listTableNames(db)) existing.add(t);

  const baseName = sanitizeIdentifier(fileName.replace(/\.[^.]+$/, ""), "data");
  const [tableName] = uniqueNames([baseName], existing);

  const columnNames = uniqueNames(
    headerRow.map((h, i) => sanitizeIdentifier(h, `column_${i + 1}`))
  );
  const types = inferColumnTypes(dataRows, columnCount);

  db.run(
    `CREATE TABLE ${quoteIdent(tableName)} (${columnNames
      .map((c, i) => `${quoteIdent(c)} ${types[i]}`)
      .join(", ")})`
  );

  const placeholders = columnNames.map(() => "?").join(", ");
  const stmt = db.prepare(
    `INSERT INTO ${quoteIdent(tableName)} VALUES (${placeholders})`
  );
  db.run("BEGIN");
  try {
    for (const row of dataRows) {
      const values: SqlValue[] = columnNames.map((_, i) => {
        const raw = (row[i] ?? "").trim();
        if (raw === "") return null;
        if (types[i] === "INTEGER") return parseInt(raw, 10);
        if (types[i] === "REAL") return parseFloat(raw);
        return row[i];
      });
      stmt.run(values);
    }
    db.run("COMMIT");
  } catch (err) {
    db.run("ROLLBACK");
    throw err;
  } finally {
    stmt.free();
  }

  return tableName;
}

/** Belt and braces: even if validation were bypassed, SQLite refuses writes. */
export function lockReadOnly(db: SqlDatabase) {
  try {
    db.run("PRAGMA query_only = ON");
  } catch {
    /* non-fatal: the SQL validator still blocks writes */
  }
}

/* ---------- reading the schema ---------- */

export type ColumnInfo = {
  name: string;
  type: string;
  primaryKey: boolean;
  references?: string;
};

export type TableInfo = {
  name: string;
  kind: "table" | "view";
  rowCount: number | null;
  columns: ColumnInfo[];
};

export type SchemaInfo = {
  tables: TableInfo[];
  /** Compact text description sent to the model. */
  promptText: string;
};

function listTableNames(db: SqlDatabase): string[] {
  const res = db.exec(
    "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'"
  );
  return res.length ? res[0].values.map((v) => String(v[0])) : [];
}

const MAX_PROMPT_CHARS = 15000;

export function extractSchema(db: SqlDatabase): SchemaInfo {
  const objects = db.exec(
    "SELECT name, type FROM sqlite_master WHERE type IN ('table', 'view') AND name NOT LIKE 'sqlite_%' ORDER BY type, name"
  );
  const rowsOfObjects = objects.length ? objects[0].values : [];

  const tables: TableInfo[] = rowsOfObjects.map(([nameRaw, typeRaw]) => {
    const name = String(nameRaw);
    const kind = typeRaw === "view" ? "view" : "table";

    // PRAGMA table_info columns: cid, name, type, notnull, dflt_value, pk
    const info = db.exec(`PRAGMA table_info(${quoteIdent(name)})`);
    const infoRows = info.length ? info[0].values : [];

    // PRAGMA foreign_key_list columns: id, seq, table, from, to, ...
    const fkMap = new Map<string, string>();
    if (kind === "table") {
      const fks = db.exec(`PRAGMA foreign_key_list(${quoteIdent(name)})`);
      for (const fk of fks.length ? fks[0].values : []) {
        fkMap.set(String(fk[3]), `${String(fk[2])}.${String(fk[4] ?? "id")}`);
      }
    }

    const columns: ColumnInfo[] = infoRows.map((r) => ({
      name: String(r[1]),
      type: String(r[2] || "").toUpperCase() || "ANY",
      primaryKey: Number(r[5]) > 0,
      references: fkMap.get(String(r[1])),
    }));

    let rowCount: number | null = null;
    if (kind === "table") {
      try {
        const c = db.exec(`SELECT COUNT(*) FROM ${quoteIdent(name)}`);
        rowCount = Number(c[0].values[0][0]);
      } catch {
        rowCount = null;
      }
    }

    return { name, kind, rowCount, columns };
  });

  return { tables, promptText: buildPromptText(tables) };
}

function buildPromptText(tables: TableInfo[]): string {
  const parts: string[] = [];
  let length = 0;

  for (const t of tables) {
    const lines = [`${t.kind === "view" ? "View" : "Table"} ${quoteIdent(t.name)}:`];
    for (const c of t.columns) {
      let line = `  - ${quoteIdent(c.name)} ${c.type}`;
      if (c.primaryKey) line += " (primary key)";
      if (c.references) line += ` -> ${c.references}`;
      lines.push(line);
    }
    const block = lines.join("\n");
    if (length + block.length > MAX_PROMPT_CHARS) {
      parts.push("(more tables omitted: schema too large)");
      break;
    }
    parts.push(block);
    length += block.length;
  }

  return parts.join("\n\n");
}

/* ---------- running queries ---------- */

export type QueryResult = {
  columns: string[];
  rows: SqlValue[][];
  truncated: boolean;
};

export function runSelect(db: SqlDatabase, sql: string): QueryResult {
  const query = validateReadOnlySql(sql);
  const stmt = db.prepare(query);
  try {
    const columns = stmt.getColumnNames();
    const rows: SqlValue[][] = [];
    let truncated = false;
    while (stmt.step()) {
      if (rows.length >= MAX_RESULT_ROWS) {
        truncated = true;
        break;
      }
      rows.push(stmt.get());
    }
    return { columns, rows, truncated };
  } finally {
    stmt.free();
  }
}
