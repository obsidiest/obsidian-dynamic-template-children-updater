import {
  dynamicToken,
  stripDynamicTokens,
} from "./dynamic-slots";
import type {
  ProjectionDiagnostic,
  TemplateProjection,
  TemplateSourceKind,
} from "./types";

interface ProjectorContext {
  diagnostics: ProjectionDiagnostic[];
  substitutions: Record<string, string>;
}

interface ParsedLiteral {
  end: number;
  projected: string;
}

interface AssignmentProjection {
  operator: "+=" | "=";
  projected: string;
}

function parseSubstitutions(
  json: string,
  diagnostics: ProjectionDiagnostic[],
): Record<string, string> {
  try {
    const parsed: unknown = JSON.parse(json || "{}");
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("The value must be a JSON object.");
    }

    const substitutions: Record<string, string> = {};
    for (const [expression, replacement] of Object.entries(parsed)) {
      if (
        replacement === null ||
        typeof replacement === "string" ||
        typeof replacement === "number" ||
        typeof replacement === "boolean"
      ) {
        substitutions[expression.trim()] = replacement === null ? "" : String(replacement);
      } else {
        diagnostics.push({
          expression,
          message: "Ignored a substitution whose value is not a string, number, boolean, or null.",
          severity: "warning",
        });
      }
    }
    return substitutions;
  } catch (error) {
    diagnostics.push({
      message: `Templater expression defaults are not valid JSON: ${errorMessage(error)}`,
      severity: "error",
    });
    return {};
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function projectExpression(rawExpression: string, context: ProjectorContext): string {
  const expression = rawExpression.trim();
  if (Object.hasOwn(context.substitutions, expression)) {
    return context.substitutions[expression] ?? "";
  }

  if (
    /^(?:noteTitle|tp\.file\.title|tp\.file\.title\(\)|title)$/u.test(expression)
  ) {
    return dynamicToken("title");
  }

  if (/^tp\.file\.cursor\s*\(/u.test(expression)) {
    return "";
  }

  if (/^tp\.date\.now\s*\(/u.test(expression)) {
    return dynamicToken("date");
  }

  if (expression === "digitalPageCount") {
    return dynamicToken("digitalPageCount");
  }

  if (expression === "parsed.edited") {
    return "false";
  }

  if (expression === "coverImageBlock") {
    return "Cover Image:";
  }

  if (expression === "sourceFileUrlsBlock") {
    return "Source File URLs:";
  }

  if (/^listBlock\s*\(/u.test(expression)) {
    const indentationMatch = /,\s*(\d+)\s*\)$/u.exec(expression);
    const indentation = Number.parseInt(indentationMatch?.[1] ?? "2", 10);
    return `${" ".repeat(Math.max(0, indentation))}- `;
  }

  if (/\?[^:]*:\s*(?:""|'')\s*$/su.test(expression)) {
    return "";
  }

  if (/^(?:q|JSON\.stringify)\s*\(/u.test(expression)) {
    return "";
  }

  if (/^(?:true|false|null|-?\d+(?:\.\d+)?)$/u.test(expression)) {
    return expression === "null" ? "" : expression;
  }

  const quoted = /^(?:"([\s\S]*)"|'([\s\S]*)')$/u.exec(expression);
  if (quoted !== null) {
    return decodeJavaScriptEscapes(quoted[1] ?? quoted[2] ?? "");
  }

  context.diagnostics.push({
    expression,
    message: "Static projection could not infer this Templater expression, so it was projected as empty. Add an exact replacement under advanced settings if needed.",
    severity: "warning",
  });
  return "";
}

function decodeJavaScriptEscapes(text: string): string {
  return text.replace(
    /\\(?:u\{([0-9A-Fa-f]+)\}|u([0-9A-Fa-f]{4})|x([0-9A-Fa-f]{2})|([nrtbfv0\\'"`$]))/gu,
    (_match, codePoint: string | undefined, unicode: string | undefined, hex: string | undefined, simple: string | undefined) => {
      if (codePoint !== undefined) {
        return String.fromCodePoint(Number.parseInt(codePoint, 16));
      }
      if (unicode !== undefined) {
        return String.fromCharCode(Number.parseInt(unicode, 16));
      }
      if (hex !== undefined) {
        return String.fromCharCode(Number.parseInt(hex, 16));
      }

      const simpleEscapes: Record<string, string> = {
        "0": "\0",
        "b": "\b",
        "f": "\f",
        "n": "\n",
        "r": "\r",
        "t": "\t",
        "v": "\v",
        "\\": "\\",
        "'": "'",
        "\"": "\"",
        "`": "`",
        "$": "$",
      };
      return simple === undefined ? _match : (simpleEscapes[simple] ?? simple);
    },
  );
}

function readBalancedExpression(source: string, start: number): { end: number; expression: string } | null {
  let depth = 1;
  let index = start;
  let quote: "'" | "\"" | "`" | null = null;
  let lineComment = false;
  let blockComment = false;

  while (index < source.length) {
    const character = source[index] ?? "";
    const next = source[index + 1] ?? "";

    if (lineComment) {
      if (character === "\n") {
        lineComment = false;
      }
      index += 1;
      continue;
    }

    if (blockComment) {
      if (character === "*" && next === "/") {
        blockComment = false;
        index += 2;
      } else {
        index += 1;
      }
      continue;
    }

    if (quote !== null) {
      if (character === "\\") {
        index += 2;
        continue;
      }
      if (character === quote) {
        quote = null;
      }
      index += 1;
      continue;
    }

    if (character === "/" && next === "/") {
      lineComment = true;
      index += 2;
      continue;
    }
    if (character === "/" && next === "*") {
      blockComment = true;
      index += 2;
      continue;
    }
    if (character === "'" || character === "\"" || character === "`") {
      quote = character;
      index += 1;
      continue;
    }
    if (character === "{") {
      depth += 1;
    } else if (character === "}") {
      depth -= 1;
      if (depth === 0) {
        return {
          end: index + 1,
          expression: source.slice(start, index),
        };
      }
    }
    index += 1;
  }

  return null;
}

function readTemplateLiteral(
  source: string,
  start: number,
  context: ProjectorContext,
): ParsedLiteral | null {
  if (source[start] !== "`") {
    return null;
  }

  let projected = "";
  let raw = "";
  let index = start + 1;

  const flushRaw = (): void => {
    projected += decodeJavaScriptEscapes(raw);
    raw = "";
  };

  while (index < source.length) {
    const character = source[index] ?? "";
    const next = source[index + 1] ?? "";

    if (character === "\\") {
      raw += character + next;
      index += 2;
      continue;
    }
    if (character === "`") {
      flushRaw();
      return { end: index + 1, projected };
    }
    if (character === "$" && next === "{") {
      flushRaw();
      const expression = readBalancedExpression(source, index + 2);
      if (expression === null) {
        context.diagnostics.push({
          message: "A JavaScript template-literal expression was not balanced.",
          severity: "error",
        });
        return null;
      }
      projected += projectExpression(expression.expression, context);
      index = expression.end;
      continue;
    }

    raw += character;
    index += 1;
  }

  context.diagnostics.push({
    message: "A JavaScript template literal used for tR output was not closed.",
    severity: "error",
  });
  return null;
}

function readQuotedLiteral(source: string, start: number): ParsedLiteral | null {
  const quote = source[start];
  if (quote !== "'" && quote !== "\"") {
    return null;
  }

  let raw = "";
  let index = start + 1;
  while (index < source.length) {
    const character = source[index] ?? "";
    const next = source[index + 1] ?? "";
    if (character === "\\") {
      raw += character + next;
      index += 2;
      continue;
    }
    if (character === quote) {
      return { end: index + 1, projected: decodeJavaScriptEscapes(raw) };
    }
    raw += character;
    index += 1;
  }
  return null;
}

function extractTRAssignments(code: string, context: ProjectorContext): AssignmentProjection[] {
  const assignments: AssignmentProjection[] = [];
  const assignmentPattern = /\btR\s*(\+=|=)\s*/gu;
  let match: RegExpExecArray | null;

  while ((match = assignmentPattern.exec(code)) !== null) {
    const operator = match[1];
    if (operator !== "+=" && operator !== "=") {
      continue;
    }

    let valueStart = assignmentPattern.lastIndex;
    while (/\s/u.test(code[valueStart] ?? "")) {
      valueStart += 1;
    }
    const literal =
      readTemplateLiteral(code, valueStart, context) ??
      readQuotedLiteral(code, valueStart);
    if (literal === null) {
      continue;
    }

    assignments.push({ operator, projected: literal.projected });
    assignmentPattern.lastIndex = literal.end;
  }
  return assignments;
}

function projectTemplaterBlocks(source: string, context: ProjectorContext): string {
  let output = "";
  let cursor = 0;

  while (cursor < source.length) {
    const open = source.indexOf("<%", cursor);
    if (open < 0) {
      output += source.slice(cursor);
      break;
    }
    output += source.slice(cursor, open);
    const close = source.indexOf("%>", open + 2);
    if (close < 0) {
      context.diagnostics.push({
        message: "A Templater block was not closed and was projected as empty.",
        severity: "error",
      });
      break;
    }

    let code = source.slice(open + 2, close);
    code = code.replace(/^[-_]\s*/u, "").replace(/[-_]\s*$/u, "");
    if (code.startsWith("*")) {
      const assignments = extractTRAssignments(code.slice(1), context);
      let codeOutput = "";
      for (const assignment of assignments) {
        codeOutput =
          assignment.operator === "="
            ? assignment.projected
            : codeOutput + assignment.projected;
      }
      output += codeOutput;
    } else {
      output += projectExpression(code, context);
    }
    cursor = close + 2;
  }

  return output;
}

function projectCoreTemplatePlaceholders(source: string): string {
  return source.replace(/\{\{\s*(title|date|time)\s*\}\}/giu, (_match, name: string) => {
    return dynamicToken(name.toLocaleLowerCase());
  });
}

function detectSourceKind(source: string): TemplateSourceKind {
  if (source.includes("<%")) {
    return "templater";
  }
  if (/\{\{\s*(?:title|date|time)\s*\}\}/iu.test(source)) {
    return "core-templates";
  }
  return "markdown";
}

export function projectTemplate(
  source: string,
  templaterExpressionDefaultsJson = "{}",
): TemplateProjection {
  const diagnostics: ProjectionDiagnostic[] = [];
  const context: ProjectorContext = {
    diagnostics,
    substitutions: parseSubstitutions(
      templaterExpressionDefaultsJson,
      diagnostics,
    ),
  };
  const sourceKind = detectSourceKind(source);
  const templaterProjected =
    sourceKind === "templater" ? projectTemplaterBlocks(source, context) : source;
  const internalMarkdown = projectCoreTemplatePlaceholders(templaterProjected)
    .replace(/\r\n?/g, "\n");

  return {
    internalMarkdown,
    previewMarkdown: stripDynamicTokens(internalMarkdown),
    diagnostics,
    sourceKind,
  };
}
