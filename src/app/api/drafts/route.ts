import { NextRequest, NextResponse } from "next/server";
import {
  createDraft,
  createDraftFromTopic,
  getDraft,
  updateDraft,
  listDraftsSummary,
} from "@/lib/db";
import { destinations } from "@/config/destinations";

export async function GET() {
  try {
    const drafts = await listDraftsSummary(destinations.length);
    return NextResponse.json({ drafts });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to list drafts" },
      { status: 500 },
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { action, id, ...fields } = body;

    if (action === "create") {
      const { fromTopicId } = fields as { fromTopicId?: string };
      if (fromTopicId) {
        const draftId = await createDraftFromTopic(fromTopicId);
        if (!draftId) {
          return NextResponse.json({ error: "Topic not found" }, { status: 404 });
        }
        return NextResponse.json({ id: draftId });
      }
      const draftId = await createDraft();
      return NextResponse.json({ id: draftId });
    }

    if (action === "update" && id) {
      await updateDraft(id, fields);
      return NextResponse.json({ ok: true });
    }

    if (action === "get" && id) {
      const draft = await getDraft(id);
      if (!draft) {
        return NextResponse.json({ error: "Draft not found" }, { status: 404 });
      }
      return NextResponse.json(draft);
    }

    return NextResponse.json({ error: "Invalid action" }, { status: 400 });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Draft operation failed" },
      { status: 500 },
    );
  }
}
