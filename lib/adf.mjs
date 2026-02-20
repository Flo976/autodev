/**
 * adf.mjs — Convert Atlassian Document Format (ADF) to plain text.
 */

export function adfToText(node) {
  if (!node) return "";
  if (typeof node === "string") return node;
  if (node.type === "text") return node.text || "";
  if (node.type === "hardBreak") return "\n";
  if (node.type === "mention") return `@${node.attrs?.text || "user"}`;
  if (node.type === "inlineCard") return node.attrs?.url || "";

  let text = "";
  if (Array.isArray(node.content)) {
    for (const child of node.content) {
      const childText = adfToText(child);
      if (node.type === "listItem") {
        text += `- ${childText}\n`;
      } else if (node.type === "heading") {
        text += `${"#".repeat(node.attrs?.level || 1)} ${childText}\n`;
      } else if (node.type === "codeBlock") {
        text += `\`\`\`\n${childText}\n\`\`\`\n`;
      } else if (node.type === "blockquote") {
        text += `> ${childText}\n`;
      } else {
        text += childText;
      }
    }
    if (["paragraph", "heading", "codeBlock", "blockquote", "rule"].includes(node.type)) {
      text += "\n";
    }
  }
  return text;
}
