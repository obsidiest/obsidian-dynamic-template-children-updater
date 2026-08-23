import { parseDocument } from "yaml";
import { isDataMap, type DataMap } from "./utils";

export interface MarkdownDocumentParts {
  body: string;
  frontmatter: string | null;
  hasFrontmatter: boolean;
}

export class FrontmatterParseError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "FrontmatterParseError";
  }
}

export function splitMarkdownDocument(markdown: string): MarkdownDocumentParts {
  const normalized = markdown.replace(/\r\n?/g, "\n");
  const hasByteOrderMark = normalized.startsWith("\uFEFF");
  const content = hasByteOrderMark ? normalized.slice(1) : normalized;
  const lines = content.split("\n");

  if ((lines[0] ?? "").trim() !== "---") {
    return { body: normalized, frontmatter: null, hasFrontmatter: false };
  }

  for (let index = 1; index < lines.length; index += 1) {
    if ((lines[index] ?? "").trim() === "---") {
      return {
        body: lines.slice(index + 1).join("\n"),
        frontmatter: lines.slice(1, index).join("\n"),
        hasFrontmatter: true,
      };
    }
  }

  throw new FrontmatterParseError("The opening frontmatter delimiter has no closing delimiter.");
}

export function parseFrontmatterMap(source: string | null): DataMap {
  if (source === null || source.trim() === "") {
    return {};
  }

  const document = parseDocument(source, {
    prettyErrors: true,
    strict: true,
    uniqueKeys: true,
  });
  if (document.errors.length > 0) {
    throw new FrontmatterParseError(
      document.errors.map((error) => error.message).join("\n"),
    );
  }

  const value: unknown = document.toJS({ mapAsMap: false, maxAliasCount: 100 });
  if (value === null) {
    return {};
  }
  if (!isDataMap(value)) {
    throw new FrontmatterParseError("Frontmatter must have a mapping at its root.");
  }
  return value;
}

export function replaceMarkdownBody(currentMarkdown: string, nextBody: string): string {
  const normalizedNextBody = nextBody.replace(/\r\n?/g, "\n");
  const normalizedCurrent = currentMarkdown.replace(/\r\n?/g, "\n");
  const parts = splitMarkdownDocument(normalizedCurrent);
  if (!parts.hasFrontmatter) {
    return normalizedNextBody;
  }

  const lines = normalizedCurrent.split("\n");
  let closingIndex = -1;
  for (let index = 1; index < lines.length; index += 1) {
    if ((lines[index] ?? "").trim() === "---") {
      closingIndex = index;
      break;
    }
  }
  if (closingIndex < 0) {
    throw new FrontmatterParseError("The current note's frontmatter is not closed.");
  }

  const prefix = lines.slice(0, closingIndex + 1).join("\n");
  return `${prefix}\n${normalizedNextBody}`;
}
