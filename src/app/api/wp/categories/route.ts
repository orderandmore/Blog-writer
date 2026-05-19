import { NextRequest, NextResponse } from "next/server";
import { getCachedCategories, createCategory, clearWpCaches } from "@/lib/wordpress";

export async function GET() {
  try {
    const categories = await getCachedCategories();
    return NextResponse.json({ categories });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to list categories" },
      { status: 500 },
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const { name, slug } = await request.json();
    if (typeof name !== "string" || name.trim().length === 0) {
      return NextResponse.json({ error: "name is required" }, { status: 400 });
    }
    const category = await createCategory(name.trim(), slug);
    clearWpCaches();
    return NextResponse.json({ category });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to create category" },
      { status: 500 },
    );
  }
}
