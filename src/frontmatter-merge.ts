import {
  materializeDynamicValue,
  matchesTemplateDefault,
  type DynamicCaptures,
} from "./dynamic-slots";
import { alignSchemas, type SchemaAlignment, type SchemaNode } from "./schema-align";
import type {
  FrontmatterMergeOptions,
  MergeConflict,
  MergeResult,
} from "./types";
import {
  cloneValue,
  deepEqual,
  getAtPath,
  isDataMap,
  pathId,
  pathLabel,
  type DataMap,
} from "./utils";

interface MergeContext {
  base: DataMap;
  baseToChild: SchemaAlignment;
  baseToNext: SchemaAlignment;
  child: DataMap;
  conflicts: MergeConflict[];
  next: DataMap;
  options: FrontmatterMergeOptions;
}

function directChildren(
  nodes: Map<string, SchemaNode>,
  parentPath: readonly string[],
): SchemaNode[] {
  const parent = pathId(parentPath);
  return [...nodes.values()].filter((node) => node.parentId === parent);
}

function materialize(
  value: unknown,
  captures: DynamicCaptures,
  context: MergeContext,
): unknown {
  return materializeDynamicValue(
    value,
    captures,
    context.options.dynamicValues,
  );
}

function mergeMappedValue(
  baseNode: SchemaNode,
  nextNode: SchemaNode,
  childNode: SchemaNode | undefined,
  context: MergeContext,
): unknown {
  if (childNode === undefined) {
    return materialize(nextNode.value, {}, context);
  }

  if (
    isDataMap(baseNode.value) &&
    isDataMap(nextNode.value) &&
    isDataMap(childNode.value)
  ) {
    return buildNextMap(nextNode.value, nextNode.path, context);
  }

  const defaultMatch = matchesTemplateDefault(childNode.value, baseNode.value);
  if (
    defaultMatch.matches ||
    context.options.applyValueUpdatesToNonDefaultValues
  ) {
    return materialize(nextNode.value, defaultMatch.captures, context);
  }
  return cloneValue(childNode.value);
}

function assignWithDataPriority(
  output: DataMap,
  key: string,
  value: unknown,
  path: readonly string[],
  context: MergeContext,
): void {
  if (Object.hasOwn(output, key) && !deepEqual(output[key], value)) {
    context.conflicts.push({
      path: pathLabel([...path, key]),
      message:
        "Two preserved fields resolved to the same key. The child-note value was retained.",
    });
  }
  output[key] = cloneValue(value);
}

function appendChildOnlyAndRemovedFields(
  output: DataMap,
  nextParentPath: readonly string[],
  context: MergeContext,
): void {
  let baseParentPath: string[];
  if (nextParentPath.length === 0) {
    baseParentPath = [];
  } else {
    const baseParentId = context.baseToNext.targetToBase.get(pathId(nextParentPath));
    const baseParentNode =
      baseParentId === undefined
        ? undefined
        : context.baseToNext.baseNodes.get(baseParentId);
    if (baseParentNode === undefined) {
      return;
    }
    baseParentPath = baseParentNode.path;
  }

  let childParentPath: string[];
  if (baseParentPath.length === 0) {
    childParentPath = [];
  } else {
    const childParentId = context.baseToChild.baseToTarget.get(pathId(baseParentPath));
    const childParentNode =
      childParentId === undefined
        ? undefined
        : context.baseToChild.targetNodes.get(childParentId);
    if (childParentNode === undefined || !isDataMap(childParentNode.value)) {
      return;
    }
    childParentPath = childParentNode.path;
  }

  for (const childNode of directChildren(
    context.baseToChild.targetNodes,
    childParentPath,
  )) {
    const baseId = context.baseToChild.targetToBase.get(childNode.id);
    if (baseId === undefined) {
      assignWithDataPriority(
        output,
        childNode.key,
        childNode.value,
        nextParentPath,
        context,
      );
      continue;
    }

    if (context.baseToNext.baseToTarget.has(baseId)) {
      continue;
    }

    const baseNode = context.baseToChild.baseNodes.get(baseId);
    if (baseNode === undefined) {
      continue;
    }
    const defaultMatch = matchesTemplateDefault(childNode.value, baseNode.value);
    if (
      !defaultMatch.matches &&
      !context.options.applyValueUpdatesToNonDefaultValues
    ) {
      assignWithDataPriority(
        output,
        childNode.key,
        childNode.value,
        nextParentPath,
        context,
      );
      context.conflicts.push({
        path: pathLabel(childNode.path),
        message:
          "The template removed this populated field; it was retained because overwriting non-default property values is disabled.",
      });
    }
  }
}

function outputKeyForMappedNode(
  baseNode: SchemaNode,
  nextNode: SchemaNode,
  childNode: SchemaNode | undefined,
  context: MergeContext,
): string {
  if (
    childNode !== undefined &&
    childNode.key !== baseNode.key &&
    !context.options.applyKeyUpdatesToNonDefaultKeys
  ) {
    return childNode.key;
  }
  return nextNode.key;
}

function buildNextMap(
  nextMap: DataMap,
  nextParentPath: readonly string[],
  context: MergeContext,
): DataMap {
  const output: DataMap = {};

  for (const [nextKey, nextValue] of Object.entries(nextMap)) {
    const nextPath = [...nextParentPath, nextKey];
    const nextNode = context.baseToNext.targetNodes.get(pathId(nextPath));
    if (nextNode === undefined) {
      output[nextKey] = materialize(nextValue, {}, context);
      continue;
    }

    const baseId = context.baseToNext.targetToBase.get(nextNode.id);
    if (baseId === undefined) {
      output[nextKey] = materialize(nextValue, {}, context);
      continue;
    }

    const baseNode = context.baseToNext.baseNodes.get(baseId);
    if (baseNode === undefined) {
      output[nextKey] = materialize(nextValue, {}, context);
      continue;
    }

    const childId = context.baseToChild.baseToTarget.get(baseNode.id);
    const childNode =
      childId === undefined
        ? undefined
        : context.baseToChild.targetNodes.get(childId);
    const outputKey = outputKeyForMappedNode(
      baseNode,
      nextNode,
      childNode,
      context,
    );
    output[outputKey] = mergeMappedValue(
      baseNode,
      nextNode,
      childNode,
      context,
    );
  }

  appendChildOnlyAndRemovedFields(output, nextParentPath, context);
  return output;
}

export function mergeFrontmatter(
  base: DataMap,
  next: DataMap,
  child: DataMap,
  options: FrontmatterMergeOptions,
): MergeResult<DataMap> {
  const context: MergeContext = {
    base,
    baseToChild: alignSchemas(base, child),
    baseToNext: alignSchemas(base, next),
    child,
    conflicts: [],
    next,
    options,
  };

  const value = buildNextMap(next, [], context);
  const classPropertyKey = options.classPropertyKey.trim();
  if (classPropertyKey !== "") {
    const childClassValue = getAtPath(child, [classPropertyKey]);
    const hasChildClass = Object.hasOwn(child, classPropertyKey);
    const nextClassValue = getAtPath(value, [classPropertyKey]);
    const hasNextClass = Object.hasOwn(value, classPropertyKey);
    delete value[classPropertyKey];
    if (hasChildClass) {
      value[classPropertyKey] = cloneValue(childClassValue);
    } else if (hasNextClass) {
      value[classPropertyKey] = cloneValue(nextClassValue);
    }
  }

  return {
    value,
    changed: !deepEqual(value, child),
    conflicts: context.conflicts,
  };
}
