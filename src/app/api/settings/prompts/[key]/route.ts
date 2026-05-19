import { NextRequest, NextResponse } from "next/server";
import { getPromptDefault } from "@/lib/prompts";
import { setPromptOverride, clearPromptOverride } from "@/lib/db";

export async function PUT(
  request: NextRequest,
  context: { params: Promise<{ key: string }> },
) {
  const { key } = await context.params;

  if (getPromptDefault(key) === null) {
    return NextResponse.json({ error: `Unknown prompt key: ${key}` }, { status: 404 });
  }

  const body = await request.json();
  const content: string | null = body?.content ?? null;

  if (content === null) {
    await clearPromptOverride(key);
    return NextResponse.json({ ok: true, override: null });
  }

  if (typeof content !== "string") {
    return NextResponse.json({ error: "content must be a string or null" }, { status: 400 });
  }

  await setPromptOverride(key, content);
  return NextResponse.json({ ok: true, override: content });
}
