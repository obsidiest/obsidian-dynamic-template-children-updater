import {
  deepEqual,
  isDataMap,
  jaccardSimilarity,
  keySimilarity,
  normalizedKey,
  pathId,
  type DataMap,
} from "./utils";

export interface SchemaNode {
  id: string;
  index: number;
  key: string;
  kind: "array" | "map" | "scalar";
  parentId: string;
  path: string[];
  value: unknown;
}

export interface SchemaAlignment {
  baseNodes: Map<string, SchemaNode>;
  baseToTarget: Map<string, string>;
  targetNodes: Map<string, SchemaNode>;
  targetToBase: Map<string, string>;
}

function valueKind(value: unknown): SchemaNode["kind"] {
  if (Array.isArray(value)) {
    return "array";
  }
  if (isDataMap(value)) {
    return "map";
  }
  return "scalar";
}

function collectNodes(root: DataMap): Map<string, SchemaNode> {
  const nodes = new Map<string, SchemaNode>();

  const visit = (mapping: DataMap, parentPath: string[]): void => {
    Object.entries(mapping).forEach(([key, value], index) => {
      const path = [...parentPath, key];
      const id = pathId(path);
      nodes.set(id, {
        id,
        index,
        key,
        kind: valueKind(value),
        parentId: pathId(parentPath),
        path,
        value,
      });
      if (isDataMap(value)) {
        visit(value, path);
      }
    });
  };

  visit(root, []);
  return nodes;
}

function immediateChildKeys(value: unknown): string[] {
  return isDataMap(value)
    ? Object.keys(value).map((key) => normalizedKey(key))
    : [];
}

function structureSimilarity(left: unknown, right: unknown): number {
  if (isDataMap(left) && isDataMap(right)) {
    return jaccardSimilarity(immediateChildKeys(left), immediateChildKeys(right));
  }
  if (Array.isArray(left) && Array.isArray(right)) {
    return deepEqual(left, right) ? 1 : 0.45;
  }
  return deepEqual(left, right) ? 1 : 0;
}

function positionalSimilarity(
  leftIndex: number,
  leftCount: number,
  rightIndex: number,
  rightCount: number,
): number {
  const leftPosition = leftCount <= 1 ? 0.5 : leftIndex / (leftCount - 1);
  const rightPosition = rightCount <= 1 ? 0.5 : rightIndex / (rightCount - 1);
  return 1 - Math.abs(leftPosition - rightPosition);
}

function siblingSimilarity(
  baseNode: SchemaNode,
  targetNode: SchemaNode,
  baseCount: number,
  targetCount: number,
): { key: number; score: number; structure: number } {
  const key = keySimilarity(baseNode.key, targetNode.key);
  const structure = structureSimilarity(baseNode.value, targetNode.value);
  const kind = baseNode.kind === targetNode.kind ? 1 : 0;
  const position = positionalSimilarity(
    baseNode.index,
    baseCount,
    targetNode.index,
    targetCount,
  );

  return {
    key,
    structure,
    score: 0.5 * key + 0.18 * kind + 0.22 * structure + 0.1 * position,
  };
}

export function alignSchemas(base: DataMap, target: DataMap): SchemaAlignment {
  const baseNodes = collectNodes(base);
  const targetNodes = collectNodes(target);
  const baseToTarget = new Map<string, string>();
  const targetToBase = new Map<string, string>();

  const pair = (baseNode: SchemaNode, targetNode: SchemaNode): boolean => {
    if (baseToTarget.has(baseNode.id) || targetToBase.has(targetNode.id)) {
      return false;
    }
    baseToTarget.set(baseNode.id, targetNode.id);
    targetToBase.set(targetNode.id, baseNode.id);
    if (isDataMap(baseNode.value) && isDataMap(targetNode.value)) {
      alignObjectChildren(baseNode.path, targetNode.path);
    }
    return true;
  };

  const directChildren = (
    nodes: Map<string, SchemaNode>,
    parentPath: string[],
  ): SchemaNode[] => {
    const parent = pathId(parentPath);
    return [...nodes.values()].filter((node) => node.parentId === parent);
  };

  const alignObjectChildren = (
    baseParentPath: string[],
    targetParentPath: string[],
  ): void => {
    const baseChildren = directChildren(baseNodes, baseParentPath);
    const targetChildren = directChildren(targetNodes, targetParentPath);

    for (const baseNode of baseChildren) {
      const exact = targetChildren.find(
        (targetNode) =>
          targetNode.key === baseNode.key && !targetToBase.has(targetNode.id),
      );
      if (exact !== undefined) {
        pair(baseNode, exact);
      }
    }

    const unmatchedBase = baseChildren.filter((node) => !baseToTarget.has(node.id));
    const unmatchedTarget = targetChildren.filter((node) => !targetToBase.has(node.id));
    const candidates: Array<{
      baseNode: SchemaNode;
      targetNode: SchemaNode;
      score: number;
    }> = [];

    for (const baseNode of unmatchedBase) {
      for (const targetNode of unmatchedTarget) {
        const similarity = siblingSimilarity(
          baseNode,
          targetNode,
          baseChildren.length,
          targetChildren.length,
        );
        const singlePair = unmatchedBase.length === 1 && unmatchedTarget.length === 1;
        const eligible =
          similarity.key >= 0.45 ||
          similarity.structure >= 0.8 ||
          (singlePair &&
            (baseNode.kind === targetNode.kind || similarity.key >= 0.25));
        const threshold = singlePair ? 0.34 : 0.55;
        if (eligible && similarity.score >= threshold) {
          candidates.push({ baseNode, targetNode, score: similarity.score });
        }
      }
    }

    candidates
      .sort((left, right) => right.score - left.score)
      .forEach(({ baseNode, targetNode }) => {
        pair(baseNode, targetNode);
      });
  };

  alignObjectChildren([], []);

  let addedPair = true;
  while (addedPair) {
    addedPair = false;
    const unmatchedBase = [...baseNodes.values()].filter(
      (node) => !baseToTarget.has(node.id),
    );
    const unmatchedTarget = [...targetNodes.values()].filter(
      (node) => !targetToBase.has(node.id),
    );

    for (const baseNode of unmatchedBase) {
      const sameKey = unmatchedTarget.filter(
        (targetNode) => normalizedKey(targetNode.key) === normalizedKey(baseNode.key),
      );
      const reverseUnique =
        sameKey.length === 1 &&
        unmatchedBase.filter(
          (candidate) => normalizedKey(candidate.key) === normalizedKey(sameKey[0]?.key ?? ""),
        ).length === 1;
      if (reverseUnique && sameKey[0] !== undefined && pair(baseNode, sameKey[0])) {
        addedPair = true;
      }
    }
  }

  const globalCandidates: Array<{
    baseNode: SchemaNode;
    score: number;
    targetNode: SchemaNode;
  }> = [];
  for (const baseNode of baseNodes.values()) {
    if (baseToTarget.has(baseNode.id)) {
      continue;
    }
    for (const targetNode of targetNodes.values()) {
      if (targetToBase.has(targetNode.id)) {
        continue;
      }
      const key = keySimilarity(baseNode.key, targetNode.key);
      const structure = structureSimilarity(baseNode.value, targetNode.value);
      const kind = baseNode.kind === targetNode.kind ? 1 : 0;
      const score = 0.62 * key + 0.25 * structure + 0.13 * kind;
      if ((key >= 0.72 || structure >= 0.9) && score >= 0.74) {
        globalCandidates.push({ baseNode, targetNode, score });
      }
    }
  }

  globalCandidates
    .sort((left, right) => right.score - left.score)
    .forEach(({ baseNode, targetNode }) => {
      pair(baseNode, targetNode);
    });

  return { baseNodes, baseToTarget, targetNodes, targetToBase };
}
