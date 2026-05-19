import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/wordpress";
import { detectSeoPlugin } from "@/lib/seo-plugin";

export async function GET() {
  try {
    const [user, seo] = await Promise.all([
      getCurrentUser(),
      detectSeoPlugin(),
    ]);
    return NextResponse.json({ user, seoPlugin: seo.plugin });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to fetch user" },
      { status: 500 },
    );
  }
}
