import { NextRequest, NextResponse } from "next/server";
import { deleteTopic, getTopic, updateTopic } from "@/lib/db";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_req: NextRequest, context: Ctx) {
  const { id } = await context.params;
  const topic = await getTopic(id);
  if (!topic) {
    return NextResponse.json({ error: "Topic not found" }, { status: 404 });
  }
  return NextResponse.json({ topic });
}

export async function PUT(req: NextRequest, context: Ctx) {
  const { id } = await context.params;
  if (!(await getTopic(id))) {
    return NextResponse.json({ error: "Topic not found" }, { status: 404 });
  }
  const body = await req.json();
  await updateTopic(id, body);
  return NextResponse.json({ topic: await getTopic(id) });
}

export async function DELETE(_req: NextRequest, context: Ctx) {
  const { id } = await context.params;
  if (!(await getTopic(id))) {
    return NextResponse.json({ error: "Topic not found" }, { status: 404 });
  }
  await deleteTopic(id);
  return NextResponse.json({ ok: true });
}
