import { NextRequest, NextResponse } from "next/server";
import { generateSqlFromQuestion } from "@/lib/groq";

const MAX_QUESTION_CHARS = 1000;
const MAX_SCHEMA_CHARS = 20000;

// The browser sends only the question and a text description of the tables
// and columns. The uploaded data itself never reaches this server.
export async function POST(req: NextRequest) {
  try {
    const { question, schema } = await req.json();

    if (!question || typeof question !== "string" || !question.trim()) {
      return NextResponse.json(
        { error: "Type a question first." },
        { status: 400 }
      );
    }
    if (question.length > MAX_QUESTION_CHARS) {
      return NextResponse.json(
        { error: "That question is too long. Keep it under 1,000 characters." },
        { status: 400 }
      );
    }
    if (!schema || typeof schema !== "string" || !schema.trim()) {
      return NextResponse.json(
        { error: "No tables found. Load a database first." },
        { status: 400 }
      );
    }
    if (schema.length > MAX_SCHEMA_CHARS) {
      return NextResponse.json(
        { error: "The database schema is too large to send." },
        { status: 400 }
      );
    }

    const sql = await generateSqlFromQuestion(question.trim(), schema);
    return NextResponse.json({ sql });
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Failed to generate SQL.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
