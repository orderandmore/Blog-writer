import { NextResponse } from "next/server";
import { listExistingSlugs } from "@/lib/wordpress";

export async function GET() {
  try {
    const slugs = await listExistingSlugs();
    return NextResponse.json({ slugs });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to list slugs", slugs: [] },
      { status: 500 },
    );
  }
}
