import { cloneValue, deepEqual, isDataMap } from "./utils";

const DYNAMIC_TOKEN_PATTERN = /__(?:DTCU|DUT)_DYNAMIC_([A-Za-z0-9_.-]+)__/g;
const EXACT_DYNAMIC_TOKEN_PATTERN =
  /^__(?:DTCU|DUT)_DYNAMIC_([A-Za-z0-9_.-]+)__$/u;

export type DynamicCaptures = Record<string, unknown>;

export function dynamicToken(name: string): string {
  const safeName = name.replace(/[^A-Za-z0-9_.-]+/g, "-");
  return `__DTCU_DYNAMIC_${safeName}__`;
}

export function stripDynamicTokens(text: string): string {
  return text.replace(DYNAMIC_TOKEN_PATTERN, "");
}

function escapeRegularExpression(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function matchDynamicString(
  defaultValue: string,
  childValue: string,
): DynamicCaptures | null {
  const tokens: string[] = [];
  let cursor = 0;
  let pattern = "^";

  for (const match of defaultValue.matchAll(DYNAMIC_TOKEN_PATTERN)) {
    const index = match.index;
    const tokenName = match[1];
    if (index === undefined || tokenName === undefined) {
      continue;
    }

    pattern += escapeRegularExpression(defaultValue.slice(cursor, index));
    pattern += "([\\s\\S]*?)";
    tokens.push(tokenName);
    cursor = index + match[0].length;
  }

  if (tokens.length === 0) {
    return defaultValue === childValue ? {} : null;
  }

  pattern += escapeRegularExpression(defaultValue.slice(cursor));
  pattern += "$";
  const result = new RegExp(pattern, "u").exec(childValue);
  if (result === null) {
    return null;
  }

  const captures: DynamicCaptures = {};
  tokens.forEach((token, index) => {
    const captured = result[index + 1] ?? "";
    if (!Object.hasOwn(captures, token)) {
      captures[token] = captured;
    }
  });
  return captures;
}

export function matchesTemplateDefault(
  childValue: unknown,
  defaultValue: unknown,
): { matches: boolean; captures: DynamicCaptures } {
  if (typeof defaultValue === "string") {
    const exactToken = EXACT_DYNAMIC_TOKEN_PATTERN.exec(defaultValue);
    const tokenName = exactToken?.[1];
    if (
      tokenName !== undefined &&
      (childValue === null ||
        typeof childValue === "string" ||
        typeof childValue === "number" ||
        typeof childValue === "boolean")
    ) {
      return {
        matches: true,
        captures: { [tokenName]: cloneValue(childValue) },
      };
    }
  }

  if (typeof childValue === "string" && typeof defaultValue === "string") {
    const captures = matchDynamicString(defaultValue, childValue);
    return captures === null
      ? { matches: false, captures: {} }
      : { matches: true, captures };
  }

  return { matches: deepEqual(childValue, defaultValue), captures: {} };
}

export function materializeDynamicValue(
  value: unknown,
  captures: DynamicCaptures,
  dynamicValues: Record<string, unknown>,
): unknown {
  if (typeof value === "string") {
    const exactToken = EXACT_DYNAMIC_TOKEN_PATTERN.exec(value);
    const tokenName = exactToken?.[1];
    if (tokenName !== undefined) {
      if (Object.hasOwn(captures, tokenName)) {
        return cloneValue(captures[tokenName]);
      }
      if (Object.hasOwn(dynamicValues, tokenName)) {
        return cloneValue(dynamicValues[tokenName]);
      }
      return "";
    }

    return value.replace(DYNAMIC_TOKEN_PATTERN, (_match, token: string) => {
      const replacement = Object.hasOwn(captures, token)
        ? captures[token]
        : dynamicValues[token];

      if (typeof replacement === "string") {
        return replacement;
      }
      if (
        typeof replacement === "number" ||
        typeof replacement === "boolean" ||
        typeof replacement === "bigint"
      ) {
        return String(replacement);
      }
      return "";
    });
  }

  if (Array.isArray(value)) {
    return value.map((item) =>
      materializeDynamicValue(item, captures, dynamicValues),
    );
  }

  if (isDataMap(value)) {
    const result: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(value)) {
      result[key] = materializeDynamicValue(child, captures, dynamicValues);
    }
    return result;
  }

  return cloneValue(value);
}
