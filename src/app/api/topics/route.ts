import { NextRequest, NextResponse } from "next/server";
import { createTopic, listTopics } from "@/lib/db";

export async function GET() {
  try {
    return NextResponse.json({ topics: await listTopics() });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to list topics" },
      { status: 500 },
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const { title, notes } = await request.json();
    if (typeof title !== "string" || title.trim().length === 0) {
      return NextResponse.json({ error: "title is required" }, { status: 400 });
    }
    const topic = await createTopic(
      title.trim(),
      typeof notes === "string" && notes.length > 0 ? notes : null,
    );
    return NextResponse.json({ topic });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to create topic" },
      { status: 500 },
    );
  }
}
