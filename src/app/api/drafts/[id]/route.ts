import { NextRequest, NextResponse } from "next/server";
import { getDraft, updateDraft, deleteDraft } from "@/lib/db";
import { cleanupScratch } from "@/lib/images";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: NextRequest, context: Ctx) {
  const { id } = await context.params;
  const row = await getDraft(id);
  if (!row) {
    return NextResponse.json({ error: "Draft not found" }, { status: 404 });
  }

  const hydrated = {
    ...row,
    frontmatter: parseJson(row.frontmatter),
    images: parseJson(row.images) ?? [],
    social_copy: parseJson(row.social_copy),
    posted_destinations: parseJson(row.posted_destinations) ?? [],
    buffer_submissions: parseJson(row.buffer_submissions) ?? {},
    social_review: parseJson(row.social_review) ?? {},
  };
  return NextResponse.json({ draft: hydrated });
}

export async function PUT(req: NextRequest, context: Ctx) {
  const { id } = await context.params;
  if (!(await getDraft(id))) {
    return NextResponse.json({ error: "Draft not found" }, { status: 404 });
  }
  const body = await req.json();
  await updateDraft(id, body);
  return NextResponse.json({ ok: true });
}

export async function DELETE(_req: NextRequest, context: Ctx) {
  const { id } = await context.params;
  if (!(await getDraft(id))) {
    return NextResponse.json({ error: "Draft not found" }, { status: 404 });
  }
  await deleteDraft(id);
  await cleanupScratch(id);
  return NextResponse.json({ ok: true });
}

function parseJson(raw: unknown): unknown {
  if (typeof raw !== "string" || raw.length === 0) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}
