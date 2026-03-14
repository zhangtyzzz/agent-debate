import { marked } from "marked";
import DOMPurify from "dompurify";

marked.setOptions({
  breaks: true,
  gfm: true,
});

export function renderMarkdown(markdown) {
  const raw = marked.parse(String(markdown || ""));
  return DOMPurify.sanitize(raw);
}
