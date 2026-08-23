import { describe, expect, it } from "vitest";
import { describeFrontmatterChanges } from "../src/change-report";
import { describeMarkdownChanges } from "../src/markdown-merge";

describe("change reporting", () => {
  it("describes property additions, removals, value updates, and ordering", () => {
    const changes = describeFrontmatterChanges(
      {
        Keep: "old",
        Remove: true,
        Nested: { First: 1, Second: 2 },
      },
      {
        Nested: { Second: 2, First: 1 },
        Keep: "new",
        Add: [],
      },
    );

    expect(changes.map((change) => change.description)).toEqual(
      expect.arrayContaining([
        expect.stringContaining("Reordered properties under Frontmatter"),
        expect.stringContaining("Removed property Remove"),
        expect.stringContaining("Updated property Keep"),
        expect.stringContaining("Added property Add"),
        expect.stringContaining("Reordered properties under Nested"),
      ]),
    );
  });

  it("describes a heading restoration without reporting duplicate additions", () => {
    const before = `# A Child Book

## Commentary

### Edited heading

Personal text.
`;
    const after = `# A Child Book

## Commentary

### Default heading

Personal text.
`;

    const changes = describeMarkdownChanges(before, after);

    expect(changes).toEqual([
      {
        category: "heading",
        description:
          "Updated heading “Edited heading” (H3) to “Default heading” (H3).",
      },
    ]);
  });

  it("describes template-added headings and updated section bodies", () => {
    const before = "## Notes\nOld text.\n";
    const after = "## Notes\nNew text.\n\n## Added\n\n";

    const changes = describeMarkdownChanges(before, after);

    expect(changes).toEqual(
      expect.arrayContaining([
        {
          category: "body",
          description: "Updated body text under “Notes” (H2).",
        },
        {
          category: "heading",
          description: "Added heading “Added” (H2).",
        },
      ]),
    );
  });
});
