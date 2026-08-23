import { describe, expect, it } from "vitest";
import { mergeMarkdownBody } from "../src/markdown-merge";
import type { MarkdownMergeOptions } from "../src/types";

function options(
  applyHeadingUpdatesToNonDefaultHeadings: boolean,
  applyBodyUpdatesToNonDefaultBody: boolean,
): MarkdownMergeOptions {
  return {
    applyHeadingUpdatesToNonDefaultHeadings,
    applyBodyUpdatesToNonDefaultBody,
    dynamicValues: { title: "A Child Book" },
  };
}

describe("mergeMarkdownBody", () => {
  const bookProjection = `# __DTCU_DYNAMIC_title__

## Official Synopses

### Amazon Synopsis

## LLM Commentary

### Google Gemini

### ChatGPT

## Personal Commentary

### Pros

#### Best Scenes

##### Best Shots

### Cons

### Personally Edited or Deleted Pages of My Copy of This Book

#### Edited Pages

#### Deleted Pages
`;

  it("renames a template heading while preserving customized body text", () => {
    const base = `# __DTCU_DYNAMIC_title__

## Official Synopses

Default synopsis.

## Personal Commentary

`;
    const next = `# __DTCU_DYNAMIC_title__

## Official Summaries

New default synopsis.

## Personal Commentary

`;
    const child = `# A Child Book

## Official Synopses

My own synopsis.

## Personal Commentary

My commentary.
`;

    const result = mergeMarkdownBody(base, next, child, options(true, false));

    expect(result.value).toContain("# A Child Book\n");
    expect(result.value).toContain("## Official Summaries\n");
    expect(result.value).toContain("My own synopsis.");
    expect(result.value).toContain("My commentary.");
    expect(result.value).not.toContain("New default synopsis.");
  });

  it("overwrites customized body text when its toggle is enabled", () => {
    const base = "## Notes\nDefault.\n";
    const next = "## Notes\nReplacement.\n";
    const child = "## Notes\nPersonal.\n";

    const result = mergeMarkdownBody(base, next, child, options(true, true));

    expect(result.value).toBe("## Notes\nReplacement.\n");
  });

  it("preserves a removed section containing custom body text by default", () => {
    const base = "## Keep\n\n## Remove\nDefault.\n";
    const next = "## Keep\n\n";
    const child = "## Keep\n\n## Remove\nImportant.\n";

    const result = mergeMarkdownBody(base, next, child, options(true, false));

    expect(result.value).toContain("## Remove\nImportant.\n");
  });

  it("reapplies a current projected heading even when the template did not change", () => {
    const projection = "## Notes\nDefault.\n";
    const child = "### Personal Notes\nPersonal.\n";

    const result = mergeMarkdownBody(
      projection,
      projection,
      child,
      options(true, false),
    );

    expect(result.value).toBe("## Notes\nPersonal.\n");
  });

  it("reapplies current projected body text even when the template did not change", () => {
    const projection = "## Notes\nDefault.\n";
    const child = "## Notes\nPersonal.\n";

    const result = mergeMarkdownBody(
      projection,
      projection,
      child,
      options(true, true),
    );

    expect(result.value).toBe(projection);
  });

  it("preserves current child customizations when both update toggles are disabled", () => {
    const projection = "## Notes\nDefault.\n";
    const child = "### Personal Notes\nPersonal.\n";

    const result = mergeMarkdownBody(
      projection,
      projection,
      child,
      options(false, false),
    );

    expect(result.value).toBe(child);
  });

  it.each([true, false])(
    "does not duplicate the dynamic first heading when a child adds a subordinate heading (updates %s)",
    (applyHeadingUpdates) => {
      const child = bookProjection
        .replace("__DTCU_DYNAMIC_title__", "A Child Book")
        .replace("#### Deleted Pages", "##### Testing\n\n#### Deleted Pages");

      const result = mergeMarkdownBody(
        bookProjection,
        bookProjection,
        child,
        options(applyHeadingUpdates, false),
      );

      expect(result.value.match(/^# A Child Book$/gmu)).toHaveLength(1);
      expect(result.value.match(/^##### Testing$/gmu)).toHaveLength(1);
    },
  );

  it("restores an edited heading without duplicating it when heading updates are enabled", () => {
    const child = bookProjection
      .replace("__DTCU_DYNAMIC_title__", "A Child Book")
      .replace("#### Edited Pages", "#### Edited Pages SINGULAR TEST ADDITION");

    const result = mergeMarkdownBody(
      bookProjection,
      bookProjection,
      child,
      options(true, false),
    );

    expect(result.value.match(/^# A Child Book$/gmu)).toHaveLength(1);
    expect(result.value.match(/^#### Edited Pages$/gmu)).toHaveLength(1);
    expect(result.value).not.toContain("Edited Pages SINGULAR TEST ADDITION");
  });

  it("retains an edited heading once when heading updates are disabled", () => {
    const child = bookProjection
      .replace("__DTCU_DYNAMIC_title__", "A Child Book")
      .replace("#### Edited Pages", "#### Edited Pages SINGULAR TEST ADDITION");

    const result = mergeMarkdownBody(
      bookProjection,
      bookProjection,
      child,
      options(false, false),
    );

    expect(result.value.match(/^# A Child Book$/gmu)).toHaveLength(1);
    expect(
      result.value.match(/^#### Edited Pages SINGULAR TEST ADDITION$/gmu),
    ).toHaveLength(1);
    expect(result.value).not.toMatch(/^#### Edited Pages$/gmu);
  });
});
