import DOMPurify from "dompurify";

/** The formatting a comment may carry: paragraphs, emphasis, lists, headings, links, simple tables. Nothing active, no images or styles. */
const ALLOWED_TAGS = ["p", "br", "div", "span", "strong", "b", "em", "i", "u", "ul", "ol", "li", "h3", "h4", "a", "blockquote", "table", "thead", "tbody", "tr", "th", "td", "hr"];
const ALLOWED_ATTR = ["href", "target", "rel"];

let hooked = false;
function ensureHook() {
  if (hooked) return;
  hooked = true;
  // Every link opens in a new tab and cannot reach back to the page.
  DOMPurify.addHook("afterSanitizeAttributes", (node) => {
    if (node.tagName === "A") {
      node.setAttribute("target", "_blank");
      node.setAttribute("rel", "noopener noreferrer");
    }
  });
}

export function sanitizeCommentHtml(html: string): string {
  ensureHook();
  return DOMPurify.sanitize(String(html ?? ""), { ALLOWED_TAGS, ALLOWED_ATTR, ALLOW_DATA_ATTR: false, ALLOWED_URI_REGEXP: /^(?:https?:|mailto:)/i });
}

/** True when sanitized HTML carries nothing a person would see. */
export function isEmptyHtml(html: string): boolean {
  const div = document.createElement("div");
  div.innerHTML = sanitizeCommentHtml(html);
  return !div.textContent?.trim();
}

/** A comment as plain text, for print: formatted comments lose their markup but keep line breaks and bullets. */
export function commentPlainText(body: string, format?: "text" | "html" | null): string {
  if (format !== "html") return body;
  const div = document.createElement("div");
  div.innerHTML = sanitizeCommentHtml(body)
    .replace(/<li[^>]*>/gi, "• ")
    .replace(/<br\s*\/?>|<\/(p|div|li|h3|h4|tr|blockquote)>/gi, "\n");
  return (div.textContent ?? "").replace(/\n{3,}/g, "\n\n").trim();
}

/** A plain-text comment as editable HTML: line breaks kept, nothing interpreted as markup. */
export function textToHtml(text: string): string {
  const esc = String(text ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  return esc.split(/\r?\n/).map((l) => `<div>${l || "<br>"}</div>`).join("");
}
