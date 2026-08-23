import { describe, expect, it } from "vitest";
import { mergeFrontmatter } from "../src/frontmatter-merge";
import type { FrontmatterMergeOptions } from "../src/types";

function options(
  applyValueUpdatesToNonDefaultValues: boolean,
  applyKeyUpdatesToNonDefaultKeys = true,
): FrontmatterMergeOptions {
  return {
    applyKeyUpdatesToNonDefaultKeys,
    applyValueUpdatesToNonDefaultValues,
    classPropertyKey: "Note Template Class",
    dynamicValues: { digitalPageCount: null, title: "Child note" },
  };
}

describe("mergeFrontmatter", () => {
  it("renames a property while preserving its non-default child value", () => {
    const base = {
      Creators: { Publishers: [null] },
      "Note Template Class": "[[Book Note Template]]",
    };
    const next = {
      Creators: { "Current Publishers": "God" },
      "Note Template Class": "[[Book Note Template]]",
    };
    const child = {
      Creators: { Publishers: ["Myself"] },
      "Note Template Class": "[[Book Note Template]]",
    };

    const result = mergeFrontmatter(base, next, child, options(false));

    expect(result.value).toEqual({
      Creators: { "Current Publishers": ["Myself"] },
      "Note Template Class": "[[Book Note Template]]",
    });
  });

  it("overwrites the same non-default value when that toggle is enabled", () => {
    const base = {
      Creators: { Publishers: [null] },
      "Note Template Class": "[[Book Note Template]]",
    };
    const next = {
      Creators: { "Current Publishers": "God" },
      "Note Template Class": "[[Book Note Template]]",
    };
    const child = {
      Creators: { Publishers: ["Myself"] },
      "Note Template Class": "[[Book Note Template]]",
    };

    const result = mergeFrontmatter(base, next, child, options(true));

    expect(result.value.Creators).toEqual({ "Current Publishers": "God" });
  });

  it("moves a populated property into a new hierarchy without losing its value", () => {
    const base = {
      Creators: { Publishers: [null] },
      "Note Template Class": "[[Book Note Template]]",
    };
    const next = {
      Publication: { Publishers: "God" },
      "Note Template Class": "[[Book Note Template]]",
    };
    const child = {
      Creators: { Publishers: ["Myself"] },
      "Note Template Class": "[[Book Note Template]]",
    };

    const result = mergeFrontmatter(base, next, child, options(false));

    expect(result.value).toEqual({
      Publication: { Publishers: ["Myself"] },
      "Note Template Class": "[[Book Note Template]]",
    });
  });

  it("retains populated removed fields when non-default value overwrites are disabled", () => {
    const base = {
      Keep: null,
      Remove: null,
      "Note Template Class": "[[Template]]",
    };
    const next = {
      Keep: null,
      Added: [],
      "Note Template Class": "[[Template]]",
    };
    const child = {
      Keep: "custom",
      Remove: "important",
      "Child-only": true,
      "Note Template Class": "[[Template]]",
    };

    const result = mergeFrontmatter(base, next, child, options(false));

    expect(result.value).toEqual({
      Keep: "custom",
      Added: [],
      Remove: "important",
      "Child-only": true,
      "Note Template Class": "[[Template]]",
    });
    expect(Object.keys(result.value).at(-1)).toBe("Note Template Class");
    expect(result.conflicts).toHaveLength(1);
  });

  it("reapplies a current projected key even when the template did not change", () => {
    const base = {
      Label: null,
      Other: null,
      "Note Template Class": "[[Template]]",
    };
    const next = {
      Label: null,
      Other: "new default",
      "Note Template Class": "[[Template]]",
    };
    const child = {
      "My label": "custom",
      Other: null,
      "Note Template Class": "[[Template]]",
    };

    const result = mergeFrontmatter(base, next, child, options(false));

    expect(result.value).toEqual({
      Label: "custom",
      Other: "new default",
      "Note Template Class": "[[Template]]",
    });
  });

  it("preserves a custom child key when property-key updates are disabled", () => {
    const projection = {
      Label: null,
      "Note Template Class": "[[Template]]",
    };
    const child = {
      "My label": "custom",
      "Note Template Class": "[[Template]]",
    };

    const result = mergeFrontmatter(
      projection,
      projection,
      child,
      options(false, false),
    );

    expect(result.value).toEqual(child);
  });

  it("reapplies a current projected value even when the template did not change", () => {
    const projection = {
      Rating: "Default",
      "Note Template Class": "[[Template]]",
    };
    const child = {
      Rating: "Personal",
      "Note Template Class": "[[Template]]",
    };

    const result = mergeFrontmatter(
      projection,
      projection,
      child,
      options(true),
    );

    expect(result.value).toEqual(projection);
  });

  it.each([true, false])(
    "preserves a numeric dynamic page count with value enforcement %s",
    (applyValueUpdates) => {
      const base = {
        "Page Counts": {
          "Digital Page Count": "__DTCU_DYNAMIC_digitalPageCount__",
        },
        Status: null,
        "Note Template Class": "[[Template]]",
      };
      const next = {
        "Page Counts": {
          "Digital Page Count": "__DTCU_DYNAMIC_digitalPageCount__",
        },
        Status: "Planned",
        "Note Template Class": "[[Template]]",
      };
      const child = {
        "Page Counts": { "Digital Page Count": 347 },
        Status: null,
        "Note Template Class": "[[Template]]",
      };

      const result = mergeFrontmatter(
        base,
        next,
        child,
        options(applyValueUpdates),
      );

      expect(result.value).toEqual({
        "Page Counts": { "Digital Page Count": 347 },
        Status: "Planned",
        "Note Template Class": "[[Template]]",
      });
      const pageCounts = result.value["Page Counts"] as Record<string, unknown>;
      expect(typeof pageCounts["Digital Page Count"]).toBe("number");
    },
  );

  it("recognizes legacy dynamic tokens in an existing baseline", () => {
    const base = {
      "Page Counts": {
        "Digital Page Count": "__DUT_DYNAMIC_digitalPageCount__",
      },
      "Note Template Class": "[[Template]]",
    };
    const next = {
      "Page Counts": {
        "Digital Page Count": "__DTCU_DYNAMIC_digitalPageCount__",
      },
      "Note Template Class": "[[Template]]",
    };
    const child = {
      "Page Counts": { "Digital Page Count": 212 },
      "Note Template Class": "[[Template]]",
    };

    const result = mergeFrontmatter(base, next, child, options(true));

    expect(result.value).toEqual(child);
  });
});
