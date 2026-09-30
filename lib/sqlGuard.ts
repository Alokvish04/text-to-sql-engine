// Removes comments and quoted text so keyword checks only look at real SQL.
function stripLiteralsAndComments(sql: string): string {
  return sql
    .replace(/--[^\n\r]*/g, " ")
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/'(?:[^']|'')*'/g, "''")
    .replace(/"(?:[^"]|"")*"/g, '""')
    .replace(/`(?:[^`]|``)*`/g, "``")
    .replace(/\[[^\]]*\]/g, "[]");
}

const BLOCKED =
  /\b(insert|update|delete|drop|alter|attach|detach|pragma|create|vacuum|reindex|truncate)\b|\breplace\s+into\b/i;

/**
 * Returns the query ready to run (trailing semicolons removed), or throws an
 * Error with a message that is safe to show to the person using the editor.
 */
export function validateReadOnlySql(sql: string): string {
  const trimmed = sql.trim().replace(/;+\s*$/, "").trim();
  if (!trimmed) throw new Error("There's no SQL to run yet.");

  const stripped = stripLiteralsAndComments(trimmed).trim();

  if (!/^(select|with)\b/i.test(stripped)) {
    throw new Error("Only SELECT queries are allowed in this editor.");
  }
  if (stripped.includes(";")) {
    throw new Error("Only a single statement can be run at a time.");
  }
  if (BLOCKED.test(stripped)) {
    throw new Error("This editor is read-only, so that statement isn't allowed.");
  }
  return trimmed;
}
