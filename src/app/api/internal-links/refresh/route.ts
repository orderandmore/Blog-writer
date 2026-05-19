import { NextResponse } from "next/server";
import { refreshInternalLinks } from "@/lib/internal-links";

export async function POST() {
  try {
    const file = await refreshInternalLinks();
    return NextResponse.json({
      count: file.links.length,
      updatedAt: file.updatedAt,
      source: file.source,
    });
  } catch (err) {
    console.error("Internal links refresh error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Refresh failed" },
      { status: 500 },
    );
  }
}
