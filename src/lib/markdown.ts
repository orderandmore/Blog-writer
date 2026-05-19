import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkGfm from "remark-gfm";
import remarkRehype from "remark-rehype";
import rehypeStringify from "rehype-stringify";

/** Parse markdown and extract metadata for the wizard's content step. */
export function parseMarkdown(raw: string): {
  title: string | null;
  headings: Array<{ level: number; text: string }>;
  wordCount: number;
  readingTime: number;
  body: string;
} {
  const lines = raw.split("\n");
  const headings: Array<{ level: number; text: string }> = [];
  let title: string | null = null;
  let bodyStartIndex = 0;

  for (let i = 0; i < lines.length; i++) {
    const match = lines[i].match(/^(#{1,6})\s+(.+)$/);
    if (match) {
      const level = match[1].length;
      const text = match[2].trim();
      headings.push({ level, text });
      if (level === 1 && title === null) {
        title = text;
        bodyStartIndex = i + 1;
      }
    }
  }

  const body =
    bodyStartIndex > 0
      ? lines.slice(bodyStartIndex).join("\n").trim()
      : raw.trim();

  const words = body.split(/\s+/).filter((w) => w.length > 0);
  const wordCount = words.length;
  const readingTime = Math.max(1, Math.ceil(wordCount / 200));

  return { title, headings, wordCount, readingTime, body };
}

/**
 * Render markdown to HTML — fed straight into WP's POST /wp/v2/posts as the
 * `content` field. WordPress wraps unblocked HTML in a single "classic" block
 * by default; that renders correctly. If you want true Gutenberg blocks per
 * paragraph/heading, that's a future enhancement.
 */
export async function renderMarkdown(markdown: string): Promise<string> {
  const result = await unified()
    .use(remarkParse)
    .use(remarkGfm)
    .use(remarkRehype, { allowDangerousHtml: true })
    .use(rehypeStringify, { allowDangerousHtml: true })
    .process(markdown);
  return String(result);
}
