import { renderMarkdown } from "./markdown";

export async function copyToClipboard(text: string): Promise<boolean> {
  if (typeof window === "undefined") return false;

  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // fall through to execCommand fallback
  }

  // navigator.clipboard is undefined over plain HTTP (non-secure context).
  // The hidden-textarea + execCommand approach still works there.
  const ta = document.createElement("textarea");
  ta.value = text;
  ta.setAttribute("readonly", "");
  ta.style.position = "fixed";
  ta.style.top = "0";
  ta.style.left = "0";
  ta.style.opacity = "0";
  ta.style.pointerEvents = "none";
  document.body.appendChild(ta);
  ta.focus();
  ta.select();
  try {
    return document.execCommand("copy");
  } catch {
    return false;
  } finally {
    document.body.removeChild(ta);
  }
}

/**
 * Strip Markdown markers so the plain-text clipboard payload looks like the
 * linked anchor text rather than `[text](url)` — if the target editor falls
 * back to text/plain (plain textareas, some chamber news fields), the
 * pasted result won't have raw URLs written out.
 */
function markdownToPlainProse(md: string): string {
  return md
    .replace(/!\[([^\]]*)\]\([^)]+\)/g, "$1") // images -> alt text
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, "$1") // links -> anchor text only
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/__([^_]+)__/g, "$1")
    .replace(/(^|[^*])\*([^*\n]+)\*/g, "$1$2")
    .replace(/(^|[^_])_([^_\n]+)_/g, "$1$2")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/^>\s+/gm, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * Wrap the rendered HTML in a minimal HTML5 document. Some rich-text paste
 * handlers (ChamberMaster's news editor in particular) sniff for a document
 * wrapper before treating a clipboard payload as rich content — a bare
 * `<p>...</p>` blob drops through to the text/plain fallback.
 */
function wrapAsHtmlDocument(html: string): string {
  return `<!DOCTYPE html><html><head><meta charset="utf-8"></head><body>${html}</body></html>`;
}

/**
 * Copy markdown to the clipboard as both text/html (rendered + wrapped) and
 * text/plain (prose with URLs stripped). Rich-text editors (chamber
 * submission forms, Google Docs) pick up the HTML payload so hyperlinks
 * land as live links; plain-text-only targets get hyperlink anchor text
 * with no raw URLs written out.
 */
export async function copyRichText(markdown: string): Promise<boolean> {
  if (typeof window === "undefined") return false;
  if (!markdown) return false;

  try {
    if (
      navigator.clipboard &&
      window.isSecureContext &&
      typeof ClipboardItem !== "undefined" &&
      typeof navigator.clipboard.write === "function"
    ) {
      const rendered = await renderMarkdown(markdown);
      const html = wrapAsHtmlDocument(rendered);
      const plain = markdownToPlainProse(markdown);
      const item = new ClipboardItem({
        "text/html": new Blob([html], { type: "text/html" }),
        "text/plain": new Blob([plain], { type: "text/plain" }),
      });
      await navigator.clipboard.write([item]);
      return true;
    }
  } catch {
    // fall through to plain-text path
  }

  return copyToClipboard(markdownToPlainProse(markdown));
}
