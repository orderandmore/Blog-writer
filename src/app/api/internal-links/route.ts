import { NextResponse } from "next/server";
import { loadInternalLinks, refreshInternalLinks } from "@/lib/internal-links";

export async function GET() {
  let file = await loadInternalLinks();
  if (!file) {
    // Lazy: serverless cold start blew the memory cache. Refresh transparently.
    try {
      file = await refreshInternalLinks();
    } catch {
      return NextResponse.json({ links: [], updatedAt: null, source: null });
    }
  }
  return NextResponse.json(file);
}
