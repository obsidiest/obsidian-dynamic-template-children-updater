import {
  materializeDynamicValue,
  matchesTemplateDefault,
  type DynamicCaptures,
} from "./dynamic-slots";
import type {
  ChildUpdateChange,
  MarkdownMergeOptions,
  MergeResult,
} from "./types";
import {
  keySimilarity,
  normalizeComparisonText,
  normalizedKey,
} from "./utils";

interface MarkdownSection {
  body: string;
  index: number;
  level: number;
  pathKey: string;
  structuralKey: string;
  title: string;
}

interface MarkdownModel {
  preamble: string;
  sections: MarkdownSection[];
}

interface SectionAlignment {
  baseToTarget: Map<number, number>;
  targetToBase: Map<number, number>;
}

interface SourceLine {
  content: string;
  end: number;
  start: number;
}

function splitSourceLines(source: string): SourceLine[] {
  const lines: SourceLine[] = [];
  let start = 0;
  while (start < source.length) {
    const newline = source.indexOf("\n", start);
    const end = newline < 0 ? source.length : newline + 1;
    const raw = source.slice(start, newline < 0 ? source.length : newline);
    lines.push({ content: raw, start, end });
    start = end;
  }
  return lines;
}

function parseMarkdown(source: string): MarkdownModel {
  const normalized = source.replace(/\r\n?/g, "\n");
  const lines = splitSourceLines(normalized);
  const headings: Array<{
    headingEnd: number;
    headingStart: number;
    level: number;
    title: string;
  }> = [];
  let fenceCharacter: "`" | "~" | null = null;
  let fenceLength = 0;

  for (const line of lines) {
    const fence = /^\s*(`{3,}|~{3,})/u.exec(line.content);
    if (fence !== null) {
      const marker = fence[1] ?? "";
      const markerCharacter = marker[0];
      if (fenceCharacter === null && (markerCharacter === "`" || markerCharacter === "~")) {
        fenceCharacter = markerCharacter;
        fenceLength = marker.length;
      } else if (
        markerCharacter === fenceCharacter &&
        marker.length >= fenceLength
      ) {
        fenceCharacter = null;
        fenceLength = 0;
      }
      continue;
    }
    if (fenceCharacter !== null) {
      continue;
    }

    const heading = /^(#{1,12})(?:[ \t]+(.*?))?[ \t]*$/u.exec(line.content);
    if (heading === null) {
      continue;
    }
    const hashes = heading[1] ?? "";
    const rawTitle = heading[2] ?? "";
    const title = rawTitle.replace(/[ \t]+#+[ \t]*$/u, "").trimEnd();
    headings.push({
      headingEnd: line.end,
      headingStart: line.start,
      level: hashes.length,
      title,
    });
  }

  const siblingOccurrences = new Map<string, number>();
  const structuralOccurrences = new Map<string, number>();
  const stack: Array<{
    level: number;
    pathKey: string;
    structuralKey: string;
  }> = [];
  const sections = headings.map((heading, index): MarkdownSection => {
    while ((stack.at(-1)?.level ?? 0) >= heading.level) {
      stack.pop();
    }
    const parentKey = stack.at(-1)?.pathKey ?? "";
    const parentStructuralKey = stack.at(-1)?.structuralKey ?? "";
    const normalizedTitle = normalizedKey(heading.title);
    const occurrenceKey = `${parentKey}\u0000${heading.level}\u0000${normalizedTitle}`;
    const occurrence = (siblingOccurrences.get(occurrenceKey) ?? 0) + 1;
    siblingOccurrences.set(occurrenceKey, occurrence);
    const pathKey = `${occurrenceKey}\u0000${occurrence}`;
    const structuralOccurrenceKey =
      `${parentStructuralKey}\u0000${heading.level}`;
    const structuralOccurrence =
      (structuralOccurrences.get(structuralOccurrenceKey) ?? 0) + 1;
    structuralOccurrences.set(
      structuralOccurrenceKey,
      structuralOccurrence,
    );
    const structuralKey =
      `${structuralOccurrenceKey}\u0000${structuralOccurrence}`;
    stack.push({ level: heading.level, pathKey, structuralKey });

    return {
      body: normalized.slice(
        heading.headingEnd,
        headings[index + 1]?.headingStart ?? normalized.length,
      ),
      index,
      level: heading.level,
      pathKey,
      structuralKey,
      title: heading.title,
    };
  });

  return {
    preamble: normalized.slice(0, headings[0]?.headingStart ?? normalized.length),
    sections,
  };
}

function alignSections(
  base: MarkdownSection[],
  target: MarkdownSection[],
): SectionAlignment {
  const baseToTarget = new Map<number, number>();
  const targetToBase = new Map<number, number>();
  const pair = (baseIndex: number, targetIndex: number): void => {
    if (!baseToTarget.has(baseIndex) && !targetToBase.has(targetIndex)) {
      baseToTarget.set(baseIndex, targetIndex);
      targetToBase.set(targetIndex, baseIndex);
    }
  };

  for (const baseSection of base) {
    const pathMatch = target.find(
      (targetSection) =>
        targetSection.pathKey === baseSection.pathKey &&
        !targetToBase.has(targetSection.index),
    );
    if (pathMatch !== undefined) {
      pair(baseSection.index, pathMatch.index);
    }
  }

  for (const baseSection of base) {
    if (baseToTarget.has(baseSection.index)) {
      continue;
    }
    const titleMatches = target.filter(
      (targetSection) =>
        matchesTemplateDefault(
          targetSection.title,
          baseSection.title,
        ).matches &&
        !targetToBase.has(targetSection.index),
    );
    if (titleMatches.length > 0) {
      titleMatches.sort((left, right) => {
        const leftDistance =
          Math.abs(left.index - baseSection.index) +
          Math.abs(left.level - baseSection.level);
        const rightDistance =
          Math.abs(right.index - baseSection.index) +
          Math.abs(right.level - baseSection.level);
        return leftDistance - rightDistance;
      });
      const firstMatch = titleMatches[0];
      if (firstMatch !== undefined) {
        pair(baseSection.index, firstMatch.index);
      }
    }
  }

  for (const baseSection of base) {
    if (baseToTarget.has(baseSection.index)) {
      continue;
    }
    const structuralMatch = target.find(
      (targetSection) =>
        targetSection.structuralKey === baseSection.structuralKey &&
        !targetToBase.has(targetSection.index),
    );
    if (structuralMatch !== undefined) {
      pair(baseSection.index, structuralMatch.index);
    }
  }

  const unmatchedBase = base.filter(
    (section) => !baseToTarget.has(section.index),
  );
  const unmatchedTarget = target.filter(
    (section) => !targetToBase.has(section.index),
  );
  const candidates: Array<{
    baseIndex: number;
    score: number;
    targetIndex: number;
  }> = [];

  for (const baseSection of unmatchedBase) {
    for (const targetSection of unmatchedTarget) {
      const title = keySimilarity(baseSection.title, targetSection.title);
      const level = 1 - Math.min(1, Math.abs(baseSection.level - targetSection.level) / 4);
      const basePosition = base.length <= 1 ? 0.5 : baseSection.index / (base.length - 1);
      const targetPosition =
        target.length <= 1 ? 0.5 : targetSection.index / (target.length - 1);
      const position = 1 - Math.abs(basePosition - targetPosition);
      const score = 0.62 * title + 0.16 * level + 0.22 * position;
      const singlePair = unmatchedBase.length === 1 && unmatchedTarget.length === 1;
      const blankPair = baseSection.title === "" && targetSection.title === "";
      if ((title >= 0.42 || blankPair || singlePair) && score >= (singlePair ? 0.3 : 0.55)) {
        candidates.push({
          baseIndex: baseSection.index,
          score,
          targetIndex: targetSection.index,
        });
      }
    }
  }

  candidates
    .sort((left, right) => right.score - left.score)
    .forEach(({ baseIndex, targetIndex }) => {
      pair(baseIndex, targetIndex);
    });

  return { baseToTarget, targetToBase };
}

function headingLabel(section: MarkdownSection): string {
  return `“${section.title}” (H${section.level})`;
}

export function describeMarkdownChanges(
  beforeSource: string,
  afterSource: string,
): ChildUpdateChange[] {
  const before = parseMarkdown(beforeSource);
  const after = parseMarkdown(afterSource);
  const alignment = alignSections(before.sections, after.sections);
  const changes: ChildUpdateChange[] = [];

  if (
    normalizeComparisonText(before.preamble) !==
    normalizeComparisonText(after.preamble)
  ) {
    changes.push({
      category: "body",
      description: "Updated body text before the first heading.",
    });
  }

  let greatestPreviousIndex = -1;
  for (const afterSection of after.sections) {
    const beforeIndex = alignment.targetToBase.get(afterSection.index);
    if (beforeIndex === undefined) {
      changes.push({
        category: "heading",
        description: `Added heading ${headingLabel(afterSection)}.`,
      });
      continue;
    }
    const beforeSection = before.sections[beforeIndex];
    if (beforeSection === undefined) {
      continue;
    }
    if (
      beforeSection.title !== afterSection.title ||
      beforeSection.level !== afterSection.level
    ) {
      changes.push({
        category: "heading",
        description: `Updated heading ${headingLabel(beforeSection)} to ${headingLabel(afterSection)}.`,
      });
    }
    if (
      normalizeComparisonText(beforeSection.body) !==
      normalizeComparisonText(afterSection.body)
    ) {
      changes.push({
        category: "body",
        description: `Updated body text under ${headingLabel(afterSection)}.`,
      });
    }
    if (beforeIndex < greatestPreviousIndex) {
      changes.push({
        category: "heading",
        description: `Reordered heading ${headingLabel(afterSection)} to match the template.`,
      });
    }
    greatestPreviousIndex = Math.max(greatestPreviousIndex, beforeIndex);
  }

  for (const beforeSection of before.sections) {
    if (!alignment.baseToTarget.has(beforeSection.index)) {
      changes.push({
        category: "heading",
        description: `Removed heading ${headingLabel(beforeSection)}.`,
      });
    }
  }

  return changes;
}

function materializeText(
  value: string,
  captures: DynamicCaptures,
  options: MarkdownMergeOptions,
): string {
  return String(
    materializeDynamicValue(value, captures, options.dynamicValues),
  );
}

function mergeText(
  base: string,
  next: string,
  child: string,
  applyNonDefaultUpdates: boolean,
  options: MarkdownMergeOptions,
): string {
  const match = matchesTemplateDefault(
    normalizeComparisonText(child),
    normalizeComparisonText(base),
  );
  if (match.matches || applyNonDefaultUpdates) {
    return materializeText(next, match.captures, options);
  }
  return child;
}

function selectMappedSection(
  base: MarkdownSection,
  next: MarkdownSection,
  child: MarkdownSection,
  options: MarkdownMergeOptions,
): MarkdownSection {
  const titleMatch = matchesTemplateDefault(child.title, base.title);
  const childHeadingIsDefault = titleMatch.matches && child.level === base.level;
  const templateHeadingChanged =
    base.title !== next.title || base.level !== next.level;
  const useNextHeading =
    options.applyHeadingUpdatesToNonDefaultHeadings ||
    (templateHeadingChanged && childHeadingIsDefault);

  return {
    body: mergeText(
      base.body,
      next.body,
      child.body,
      options.applyBodyUpdatesToNonDefaultBody,
      options,
    ),
    index: next.index,
    level: useNextHeading ? next.level : child.level,
    pathKey: next.pathKey,
    structuralKey: next.structuralKey,
    title: useNextHeading
      ? materializeText(next.title, titleMatch.captures, options)
      : child.title,
  };
}

function shouldPreserveRemovedSection(
  base: MarkdownSection,
  child: MarkdownSection,
  options: MarkdownMergeOptions,
): boolean {
  const titleMatch = matchesTemplateDefault(child.title, base.title);
  const customHeading = !titleMatch.matches || child.level !== base.level;
  const customBody =
    normalizeComparisonText(child.body) !== normalizeComparisonText(base.body);
  return (
    (customHeading && !options.applyHeadingUpdatesToNonDefaultHeadings) ||
    (customBody && !options.applyBodyUpdatesToNonDefaultBody)
  );
}

function serializeMarkdown(model: MarkdownModel): string {
  return (
    model.preamble +
    model.sections
      .map((section) => {
        const hashes = "#".repeat(Math.max(1, Math.min(12, section.level)));
        return `${hashes} ${section.title}\n${section.body}`;
      })
      .join("")
  );
}

export function mergeMarkdownBody(
  baseSource: string,
  nextSource: string,
  childSource: string,
  options: MarkdownMergeOptions,
): MergeResult<string> {
  const base = parseMarkdown(baseSource);
  const next = parseMarkdown(nextSource);
  const child = parseMarkdown(childSource);
  const baseToNext = alignSections(base.sections, next.sections);
  const baseToChild = alignSections(base.sections, child.sections);
  const outputSections: MarkdownSection[] = [];
  const nextOutputIndex = new Map<number, number>();

  for (const nextSection of next.sections) {
    const baseIndex = baseToNext.targetToBase.get(nextSection.index);
    let output: MarkdownSection;
    if (baseIndex === undefined) {
      output = {
        ...nextSection,
        body: materializeText(nextSection.body, {}, options),
        title: materializeText(nextSection.title, {}, options),
      };
    } else {
      const baseSection = base.sections[baseIndex];
      const childIndex = baseToChild.baseToTarget.get(baseIndex);
      const childSection =
        childIndex === undefined ? undefined : child.sections[childIndex];
      if (baseSection === undefined || childSection === undefined) {
        output = {
          ...nextSection,
          body: materializeText(nextSection.body, {}, options),
          title: materializeText(nextSection.title, {}, options),
        };
      } else {
        output = selectMappedSection(baseSection, nextSection, childSection, options);
      }
    }
    nextOutputIndex.set(nextSection.index, outputSections.length);
    outputSections.push(output);
  }

  const extrasAfter = new Map<number, MarkdownSection[]>();
  const addExtra = (anchor: number, section: MarkdownSection): void => {
    const extras = extrasAfter.get(anchor) ?? [];
    extras.push(section);
    extrasAfter.set(anchor, extras);
  };

  for (const childSection of child.sections) {
    const baseIndex = baseToChild.targetToBase.get(childSection.index);
    let preserve = baseIndex === undefined;
    if (baseIndex !== undefined && !baseToNext.baseToTarget.has(baseIndex)) {
      const baseSection = base.sections[baseIndex];
      preserve =
        baseSection !== undefined &&
        shouldPreserveRemovedSection(baseSection, childSection, options);
    }
    if (!preserve) {
      continue;
    }

    let anchor = -1;
    for (let previous = childSection.index - 1; previous >= 0; previous -= 1) {
      const previousBase = baseToChild.targetToBase.get(previous);
      const nextIndex =
        previousBase === undefined
          ? undefined
          : baseToNext.baseToTarget.get(previousBase);
      if (nextIndex !== undefined) {
        anchor = nextOutputIndex.get(nextIndex) ?? -1;
        break;
      }
    }
    addExtra(anchor, childSection);
  }

  const interleaved: MarkdownSection[] = [...(extrasAfter.get(-1) ?? [])];
  outputSections.forEach((section, index) => {
    interleaved.push(section, ...(extrasAfter.get(index) ?? []));
  });

  const mergedModel: MarkdownModel = {
    preamble: mergeText(
      base.preamble,
      next.preamble,
      child.preamble,
      options.applyBodyUpdatesToNonDefaultBody,
      options,
    ),
    sections: interleaved,
  };
  const value = serializeMarkdown(mergedModel);
  return {
    value,
    changed: value !== childSource.replace(/\r\n?/g, "\n"),
    conflicts: [],
  };
}
