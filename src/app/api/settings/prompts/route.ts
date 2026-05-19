import { NextResponse } from "next/server";
import { listPromptKeys, getPromptDefault } from "@/lib/prompts";
import { listPromptOverrides } from "@/lib/db";

export async function GET() {
  const overridesByKey = new Map(
    (await listPromptOverrides()).map((r) => [r.key, r]),
  );

  const entries = listPromptKeys().map((key) => {
    const override = overridesByKey.get(key);
    return {
      key,
      default: getPromptDefault(key) ?? "",
      override: override?.content ?? null,
      updatedAt: override?.updated_at ?? null,
    };
  });

  return NextResponse.json({ prompts: entries });
}
