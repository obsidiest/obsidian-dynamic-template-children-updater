import { describe, expect, it, vi } from "vitest";
import { DEFAULT_SETTINGS } from "../src/types";

vi.mock("obsidian", () => {
  class AbstractInputSuggest {
    public app: unknown;
    public limit = 0;

    public constructor(app: unknown) {
      this.app = app;
    }

    public close(): void {}

    public onSelect(): void {}
  }

  class Modal {
    public app: unknown;

    public constructor(app: unknown) {
      this.app = app;
    }
  }

  class PluginSettingTab {
    public app: unknown;

    public constructor(app: unknown) {
      this.app = app;
    }

    public hide(): void {}

    public update(): void {}
  }

  class EmptyComponent {}

  return {
    AbstractInputSuggest,
    App: class {},
    ButtonComponent: EmptyComponent,
    ExtraButtonComponent: EmptyComponent,
    Modal,
    normalizePath: (value: string) => value,
    Notice: class {},
    Plugin: class {},
    PluginSettingTab,
    prepareFuzzySearch: () => () => null,
    setIcon: () => undefined,
    Setting: EmptyComponent,
    SliderComponent: EmptyComponent,
    TextComponent: EmptyComponent,
    TFolder: class {},
  };
});

import { DynamicTemplateChildrenUpdaterSettingTab } from "../src/settings";

interface SearchableDefinition {
  name: string;
  desc?: string;
  aliases?: string[];
  control?: {
    key: string;
    type: string;
  };
  render?: unknown;
}

function searchableDefinitions(items: unknown[]): SearchableDefinition[] {
  const definitions: SearchableDefinition[] = [];
  for (const item of items) {
    if (item === null || typeof item !== "object") {
      continue;
    }
    const candidate = item as Record<string, unknown>;
    if (typeof candidate.name === "string") {
      definitions.push(candidate as unknown as SearchableDefinition);
    }
    if (Array.isArray(candidate.items)) {
      definitions.push(...searchableDefinitions(candidate.items));
    }
  }
  return definitions;
}

describe("declarative settings", () => {
  it("indexes every user-facing setting with searchable metadata", () => {
    const host = {
      settings: {
        ...DEFAULT_SETTINGS,
        noteTemplateLocations: [...DEFAULT_SETTINGS.noteTemplateLocations],
      },
      saveSettings: vi.fn(),
    };
    const tab = new DynamicTemplateChildrenUpdaterSettingTab(
      {} as never,
      host as never,
    );

    const groups = tab.getSettingDefinitions();
    expect(
      groups.map((group) => ("heading" in group ? group.heading : null)),
    ).toEqual([
      "Template discovery",
      "Update behavior",
      "Update reports",
      "Templater projection",
    ]);

    const definitions = searchableDefinitions(groups);
    expect(definitions.map((definition) => definition.name)).toEqual([
      "Note template class property",
      "Note template locations",
      "Automatically update note template children",
      "Apply given default property key updates to existing child notes with non-default property keys",
      "Apply given default property value updates to existing child notes with non-default property values",
      "Apply given default heading updates to existing child notes with non-default heading values",
      "Apply given default body text updates for a heading to existing child notes with non-default body text",
      "Automatic update debounce",
      "Show detailed changes in manual update report",
      "Maximum amount of changed notes to display in this report",
      "Templater expression defaults",
    ]);
    expect(
      definitions.every(
        (definition) =>
          typeof definition.desc === "string" &&
          definition.desc.length > 0 &&
          Array.isArray(definition.aliases) &&
          definition.aliases.length > 0 &&
          (definition.control !== undefined || definition.render !== undefined),
      ),
    ).toBe(true);
  });

  it("uses a validated numeric control for automatic update debounce", () => {
    const host = {
      settings: { ...DEFAULT_SETTINGS },
      saveSettings: vi.fn(),
    };
    const tab = new DynamicTemplateChildrenUpdaterSettingTab(
      {} as never,
      host as never,
    );
    const debounce = searchableDefinitions(tab.getSettingDefinitions()).find(
      (definition) => definition.name === "Automatic update debounce",
    );

    expect(debounce?.control).toMatchObject({
      key: "updateDebounceMilliseconds",
      type: "number",
    });
  });
});
