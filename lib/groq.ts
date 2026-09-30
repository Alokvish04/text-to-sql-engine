const GROQ_URL = "https://api.groq.com/openai/v1/chat/completions";

// llama-3.3-70b-versatile was retired by Groq; gpt-oss-120b is the
// recommended replacement. Override with GROQ_MODEL in .env.local if
// Groq retires this one too.
const MODEL = process.env.GROQ_MODEL || "openai/gpt-oss-120b";

function buildSystemPrompt(schemaText: string): string {
  return `You are a SQL generator for a SQLite database with this schema:

${schemaText}

Rules:
- Output ONLY a single valid SQLite SELECT statement. Nothing else.
- Do not wrap the SQL in markdown code fences or add any explanation.
- Use SQLite syntax and functions only.
- Use the table and column names exactly as written above, wrapped in double quotes when they contain anything other than letters, digits and underscores.
- Only reference the tables and columns listed above. Use the foreign keys (shown as "-> table.column") to join tables.
- Never write INSERT, UPDATE, DELETE, DROP, ALTER, or any statement that isn't a SELECT.
- If the question truly cannot be answered with a SELECT on this schema, output exactly:
  SELECT 'This question cannot be answered with the available tables.' AS message`;
}

function stripCodeFences(raw: string): string {
  return raw
    .trim()
    .replace(/^```sql\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/```$/i, "")
    .trim();
}

export async function generateSqlFromQuestion(
  question: string,
  schemaText: string
): Promise<string> {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) {
    throw new Error(
      "GROQ_API_KEY is not set. Add it to .env.local (see .env.example)."
    );
  }

  const res = await fetch(GROQ_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: MODEL,
      temperature: 0,
      max_tokens: 1024,
      reasoning_effort: "low",
      messages: [
        { role: "system", content: buildSystemPrompt(schemaText) },
        { role: "user", content: question },
      ],
    }),
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(
      `Groq API request failed (${res.status}). ${detail.slice(0, 200)}`
    );
  }

  const data = await res.json();
  const raw: string | undefined = data?.choices?.[0]?.message?.content;
  if (!raw) {
    throw new Error("Groq returned an empty response.");
  }

  return stripCodeFences(raw);
}
