import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { loadInternalLinks } from "@/lib/internal-links";
import { renderPrompt, resolvePrompt } from "@/lib/prompts";
import { DEFAULT_ARTICLE_MODEL, isArticleModel } from "@/config/models";

const MODEL = process.env.LLM_MODEL || "claude-sonnet-4-6";

async function buildLinksBlock(): Promise<string> {
  const linksFile = await loadInternalLinks();
  const linksList = linksFile?.links || [];
  const linksForPrompt = linksList.slice(0, 100);
  if (linksForPrompt.length === 0) {
    return "\n\n(No internal links list available — refresh in the UI to enable internal linking.)";
  }
  return `\n\nAvailable internal links (pick relevant ones for inline linking):\n${JSON.stringify(linksForPrompt, null, 2)}`;
}

function getClient() {
  return new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
}

async function callClaude(
  systemPrompt: string,
  userPrompt: string,
  maxTokens = 4096,
  modelOverride?: string,
): Promise<string> {
  const message = await getClient().messages.create({
    model: modelOverride || MODEL,
    max_tokens: maxTokens,
    system: systemPrompt,
    messages: [{ role: "user", content: userPrompt }],
  });
  const textBlock = message.content.find((b) => b.type === "text");
  return textBlock ? textBlock.text : "";
}

async function callClaudeStructured<T>(
  systemPrompt: string,
  messages: Anthropic.MessageParam[],
  toolName: string,
  toolDescription: string,
  inputSchema: Anthropic.Tool.InputSchema,
  maxTokens = 8192,
): Promise<T> {
  const message = await getClient().messages.create({
    model: MODEL,
    max_tokens: maxTokens,
    system: systemPrompt,
    tools: [{ name: toolName, description: toolDescription, input_schema: inputSchema }],
    tool_choice: { type: "tool", name: toolName },
    messages,
  });
  const toolUse = message.content.find((b) => b.type === "tool_use");
  if (!toolUse || toolUse.type !== "tool_use") {
    throw new Error(`Model returned no tool_use block (stop_reason=${message.stop_reason})`);
  }
  return toolUse.input as T;
}

function extractJson(text: string): unknown {
  const jsonMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const raw = jsonMatch ? jsonMatch[1].trim() : text.trim();
  return JSON.parse(raw);
}

function stripFences(text: string): string {
  const trimmed = text.trim();
  const fenceMatch = trimmed.match(/^```(?:markdown|md)?\n?([\s\S]*?)\n?```$/);
  return fenceMatch ? fenceMatch[1].trim() : trimmed;
}

// Social character limits. Instagram has no hard limit we enforce.
const SOCIAL_LIMITS: Record<string, number> = {
  gmb: 1500,
  facebook: 500,
  pinterest: 500,
};

type SocialBundle = {
  gmb: string;
  facebook: string;
  instagram: string;
  pinterest: string;
};

function checkLimits(data: SocialBundle): string[] {
  const over: string[] = [];
  for (const [field, limit] of Object.entries(SOCIAL_LIMITS)) {
    const value = (data as Record<string, string>)[field] || "";
    if (value.length > limit) {
      over.push(`${field} was ${value.length} chars (max ${limit})`);
    }
  }
  return over;
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const {
      field,
      title,
      body: articleBody,
      imageCount,
      imageTypes,
      filenames,
      url,
      notes,
      article,
      instruction,
      model: requestedModel,
    } = body;
    const brandRules = await resolvePrompt("brand");
    const articleModel = isArticleModel(requestedModel)
      ? requestedModel
      : DEFAULT_ARTICLE_MODEL;

    switch (field) {
      case "metadata-batch": {
        const systemPrompt = await renderPrompt("metadata-batch.system", { brandRules });
        const userPrompt = await renderPrompt("metadata-batch.user", {
          title: title || "",
          body: (articleBody || "").slice(0, 6000),
        });
        const response = await callClaude(systemPrompt, userPrompt);
        const data = extractJson(response);
        return NextResponse.json({ data });
      }

      case "description": {
        const systemPrompt = await renderPrompt("description.system", { brandRules });
        const userPrompt = await renderPrompt("description.user", {
          title: title || "",
          body: (articleBody || "").slice(0, 4000),
        });
        const response = await callClaude(systemPrompt, userPrompt);
        return NextResponse.json({ data: response.trim().replace(/^["']|["']$/g, "") });
      }

      case "seoTitle": {
        const systemPrompt = await renderPrompt("seoTitle.system", { brandRules });
        const userPrompt = await renderPrompt("seoTitle.user", {
          title: title || "",
          body: (articleBody || "").slice(0, 2000),
        });
        const response = await callClaude(systemPrompt, userPrompt);
        return NextResponse.json({ data: response.trim().replace(/^["']|["']$/g, "") });
      }

      case "seoDescription": {
        const systemPrompt = await renderPrompt("seoDescription.system", { brandRules });
        const userPrompt = await renderPrompt("seoDescription.user", {
          title: title || "",
          body: (articleBody || "").slice(0, 4000),
        });
        const response = await callClaude(systemPrompt, userPrompt);
        return NextResponse.json({ data: response.trim().replace(/^["']|["']$/g, "") });
      }

      case "tags": {
        const systemPrompt = await renderPrompt("tags.system", { brandRules });
        const userPrompt = await renderPrompt("tags.user", {
          title: title || "",
          body: (articleBody || "").slice(0, 2000),
        });
        const response = await callClaude(systemPrompt, userPrompt);
        const tags = extractJson(response);
        return NextResponse.json({ data: tags });
      }

      case "image-filenames": {
        const systemPrompt = await renderPrompt("image-filenames.system");
        const userPrompt = await renderPrompt("image-filenames.user", {
          imageCount: String(imageCount ?? ""),
          title: title || "",
          imageTypes: (imageTypes || []).join(", "),
          body: (articleBody || "").slice(0, 1500),
        });
        const response = await callClaude(systemPrompt, userPrompt);
        const result = extractJson(response);
        return NextResponse.json({ data: result });
      }

      case "alt-text": {
        const systemPrompt = await renderPrompt("alt-text.system");
        const userPrompt = await renderPrompt("alt-text.user", {
          imageCount: String(imageCount ?? ""),
          title: title || "",
          filenames: (filenames || []).join(", "),
          body: (articleBody || "").slice(0, 1500),
        });
        const response = await callClaude(systemPrompt, userPrompt);
        const result = extractJson(response);
        return NextResponse.json({ data: result });
      }

      case "socialAndPress": {
        // Name kept for backward compat with the wizard fetch call. Despite
        // the name, this now produces ONLY social copy — no press release.
        if (!url || typeof url !== "string") {
          return NextResponse.json(
            {
              error:
                "socialAndPress requires the article permalink as `url` — publish (or pick a status=draft slug first) so the canonical URL can be referenced.",
            },
            { status: 400 },
          );
        }

        const contactName = process.env.COMPANY_CONTACT_NAME || "Patty Powers";
        const contactEmail =
          process.env.COMPANY_CONTACT_EMAIL || "patty@orderandmore.com";
        const contactPhone = process.env.COMPANY_CONTACT_PHONE || "";

        const linksBlock = await buildLinksBlock();
        const urlVars = { url };

        const systemPrompt = await renderPrompt("socialAndPress.system", {
          brandRules,
          url,
        });
        const userPrompt = await renderPrompt("socialAndPress.user", {
          title: title || "",
          url,
          contactName,
          contactEmail,
          contactPhoneSuffix: contactPhone ? `, ${contactPhone}` : "",
          body: (articleBody || "").slice(0, 6000),
          linksBlock,
        });

        const inputSchema: Anthropic.Tool.InputSchema = {
          type: "object",
          properties: {
            gmb: {
              type: "string",
              description: await renderPrompt("socialAndPress.schema.gmb", urlVars),
            },
            facebook: {
              type: "string",
              description: await renderPrompt("socialAndPress.schema.facebook", urlVars),
            },
            instagram: {
              type: "string",
              description: await renderPrompt("socialAndPress.schema.instagram", urlVars),
            },
            pinterest: {
              type: "string",
              description: await renderPrompt("socialAndPress.schema.pinterest", urlVars),
            },
          },
          required: ["gmb", "facebook", "instagram", "pinterest"],
        };

        const messages: Anthropic.MessageParam[] = [{ role: "user", content: userPrompt }];

        let data = await callClaudeStructured<SocialBundle>(
          systemPrompt,
          messages,
          "emit_social_copy",
          "Emit social media copy for GMB, Facebook, Instagram, X, and Pinterest in one structured response.",
          inputSchema,
        );

        let warnings = checkLimits(data);
        if (warnings.length > 0) {
          const retryMessages: Anthropic.MessageParam[] = [
            ...messages,
            {
              role: "assistant",
              content: [
                {
                  type: "tool_use",
                  id: "retry_target",
                  name: "emit_social_copy",
                  input: data as unknown as Record<string, unknown>,
                },
              ],
            },
            {
              role: "user",
              content: [
                {
                  type: "tool_result",
                  tool_use_id: "retry_target",
                  content: `Your previous output exceeded the character limits: ${warnings.join(
                    "; ",
                  )}. Rewrite every field so every platform stays within its limit. Keep any article URL intact where required. No hashtags.`,
                },
              ],
            },
          ];

          try {
            data = await callClaudeStructured<SocialBundle>(
              systemPrompt,
              retryMessages,
              "emit_social_copy",
              "Emit social media copy for GMB, Facebook, Instagram, X, and Pinterest in one structured response.",
              inputSchema,
            );
            warnings = checkLimits(data);
          } catch {
            // ignored — keep first response
          }
        }

        return NextResponse.json({ data, warnings });
      }

      case "articleDraft": {
        if (typeof title !== "string" || title.trim().length === 0) {
          return NextResponse.json(
            { error: "articleDraft requires a topic `title`." },
            { status: 400 },
          );
        }
        const linksBlock = await buildLinksBlock();
        const systemPrompt = await renderPrompt("articleDraft.system", { brandRules });
        const userPrompt = await renderPrompt("articleDraft.user", {
          title: title.trim(),
          notes: typeof notes === "string" ? notes.trim() : "(none provided)",
          linksBlock,
        });
        const markdown = await callClaude(systemPrompt, userPrompt, 8192, articleModel);
        return NextResponse.json({ data: stripFences(markdown), model: articleModel });
      }

      case "articleRevise": {
        if (typeof article !== "string" || article.trim().length === 0) {
          return NextResponse.json(
            { error: "articleRevise requires the current `article` markdown." },
            { status: 400 },
          );
        }
        if (typeof instruction !== "string" || instruction.trim().length === 0) {
          return NextResponse.json(
            { error: "articleRevise requires an `instruction`." },
            { status: 400 },
          );
        }
        const linksBlock = await buildLinksBlock();
        const systemPrompt = await renderPrompt("articleRevise.system", { brandRules });
        const userPrompt = await renderPrompt("articleRevise.user", {
          article,
          instruction: instruction.trim(),
          linksBlock,
        });
        const markdown = await callClaude(systemPrompt, userPrompt, 8192, articleModel);
        return NextResponse.json({ data: stripFences(markdown), model: articleModel });
      }

      default:
        return NextResponse.json(
          { error: `Unknown field: ${field}` },
          { status: 400 },
        );
    }
  } catch (err) {
    console.error("AI generation error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Generation failed" },
      { status: 500 },
    );
  }
}
