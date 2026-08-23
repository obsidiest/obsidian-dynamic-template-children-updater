import type { ChildUpdateChange } from "./types";
import {
  deepEqual,
  isDataMap,
  pathLabel,
  type DataMap,
} from "./utils";

const MAXIMUM_DISPLAY_VALUE_LENGTH = 180;

function displayValue(value: unknown): string {
  let display: string;
  if (value === undefined) {
    display = "undefined";
  } else if (typeof value === "string") {
    display = JSON.stringify(value);
  } else {
    try {
      display = JSON.stringify(value) ?? `<${typeof value}>`;
    } catch {
      display = `<unserializable ${typeof value}>`;
    }
  }
  if (display.length <= MAXIMUM_DISPLAY_VALUE_LENGTH) {
    return display;
  }
  return `${display.slice(0, MAXIMUM_DISPLAY_VALUE_LENGTH - 1)}…`;
}

function sameOrder(left: readonly string[], right: readonly string[]): boolean {
  return (
    left.length === right.length &&
    left.every((value, index) => value === right[index])
  );
}

function collectMapChanges(
  before: DataMap,
  after: DataMap,
  parentPath: readonly string[],
  changes: ChildUpdateChange[],
): void {
  const beforeKeys = Object.keys(before);
  const afterKeys = Object.keys(after);
  const beforeCommonOrder = beforeKeys.filter((key) => Object.hasOwn(after, key));
  const afterCommonOrder = afterKeys.filter((key) => Object.hasOwn(before, key));

  if (
    beforeCommonOrder.length > 1 &&
    !sameOrder(beforeCommonOrder, afterCommonOrder)
  ) {
    changes.push({
      category: "property",
      description: `Reordered properties under ${pathLabel(parentPath)} to match the template.`,
    });
  }

  for (const key of beforeKeys) {
    if (!Object.hasOwn(after, key)) {
      changes.push({
        category: "property",
        description: `Removed property ${pathLabel([...parentPath, key])} (previous value: ${displayValue(before[key])}).`,
      });
    }
  }

  for (const key of afterKeys) {
    const path = [...parentPath, key];
    if (!Object.hasOwn(before, key)) {
      changes.push({
        category: "property",
        description: `Added property ${pathLabel(path)} with value ${displayValue(after[key])}.`,
      });
      continue;
    }

    const beforeValue = before[key];
    const afterValue = after[key];
    if (isDataMap(beforeValue) && isDataMap(afterValue)) {
      collectMapChanges(beforeValue, afterValue, path, changes);
    } else if (!deepEqual(beforeValue, afterValue)) {
      changes.push({
        category: "property",
        description: `Updated property ${pathLabel(path)} from ${displayValue(beforeValue)} to ${displayValue(afterValue)}.`,
      });
    }
  }
}

export function describeFrontmatterChanges(
  before: DataMap,
  after: DataMap,
): ChildUpdateChange[] {
  const changes: ChildUpdateChange[] = [];
  collectMapChanges(before, after, [], changes);
  return changes;
}
