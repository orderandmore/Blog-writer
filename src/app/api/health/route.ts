import { NextResponse } from "next/server";
import { ensureSchema } from "@/lib/db";
import { Pool } from "pg";

export async function GET() {
  try {
    await ensureSchema();
    if (!process.env.DATABASE_URL) {
      return NextResponse.json({ status: "ok", db: "unconfigured" });
    }
    const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 1 });
    const { rows } = await pool.query(
      `SELECT
         (SELECT COUNT(*)::int FROM drafts WHERE status = 'draft') AS draft_count,
         (SELECT COUNT(*)::int FROM drafts WHERE status = 'published') AS published_count,
         (SELECT updated_at FROM drafts WHERE status = 'published' ORDER BY updated_at DESC LIMIT 1) AS last_published`,
    );
    await pool.end();
    const row = rows[0];
    return NextResponse.json({
      status: "ok",
      drafts: row?.draft_count ?? 0,
      publishedFromPortal: row?.published_count ?? 0,
      lastPublished: row?.last_published ?? null,
    });
  } catch {
    return NextResponse.json({ status: "ok", drafts: 0, publishedFromPortal: 0 });
  }
}
