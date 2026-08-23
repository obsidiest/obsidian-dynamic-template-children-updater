import {
  AbstractInputSuggest,
  App,
  ButtonComponent,
  ExtraButtonComponent,
  Modal,
  normalizePath,
  Notice,
  Plugin,
  PluginSettingTab,
  prepareFuzzySearch,
  setIcon,
  Setting,
  type SettingDefinitionItem,
  SliderComponent,
  TextComponent,
  TFolder,
} from "obsidian";
import {
  DEFAULT_MAXIMUM_CHANGED_NOTES_IN_REPORT,
  DEFAULT_SETTINGS,
  MAXIMUM_CHANGED_NOTES_IN_REPORT,
  MINIMUM_CHANGED_NOTES_IN_REPORT,
  type DynamicTemplateChildrenUpdaterSettings,
} from "./types";
import { clamp } from "./utils";

export interface SettingsPluginHost extends Plugin {
  settings: DynamicTemplateChildrenUpdaterSettings;
  saveSettings(reconcile?: boolean): Promise<void>;
}

type SettingsKey = keyof DynamicTemplateChildrenUpdaterSettings;

const SETTINGS_KEYS = new Set<string>(Object.keys(DEFAULT_SETTINGS));

function normalizeFolderLocation(value: string): string {
  const trimmed = value.trim();
  if (trimmed === "" || trimmed === "/") {
    return trimmed;
  }
  return normalizePath(trimmed.replace(/^\/+|\/+$/gu, ""));
}

function folderLocation(folder: TFolder): string {
  return folder.path === "" || folder.path === "/"
    ? "/"
    : normalizeFolderLocation(folder.path);
}

function vaultFolders(app: App): TFolder[] {
  const folders = [
    app.vault.getRoot(),
    ...app.vault
      .getAllLoadedFiles()
      .filter((file): file is TFolder => file instanceof TFolder),
  ];
  const byLocation = new Map<string, TFolder>();
  for (const folder of folders) {
    byLocation.set(folderLocation(folder), folder);
  }
  return [...byLocation.values()].sort((left, right) =>
    folderLocation(left).localeCompare(folderLocation(right)),
  );
}

function resolveFolder(app: App, value: string): TFolder | null {
  const location = normalizeFolderLocation(value);
  if (location === "/") {
    return app.vault.getRoot();
  }
  if (location === "") {
    return null;
  }
  const file = app.vault.getAbstractFileByPath(location);
  return file instanceof TFolder ? file : null;
}

class TemplateFolderInputSuggest extends AbstractInputSuggest<TFolder> {
  public constructor(
    app: App,
    inputEl: HTMLInputElement,
    private readonly excludedLocations: ReadonlySet<string>,
  ) {
    super(app, inputEl);
    this.limit = 1_000;
  }

  protected override getSuggestions(query: string): TFolder[] {
    const available = vaultFolders(this.app).filter(
      (folder) => !this.excludedLocations.has(folderLocation(folder)),
    );
    const trimmed = query.trim();
    if (trimmed === "") {
      return available;
    }
    const fuzzySearch = prepareFuzzySearch(trimmed);
    return available
      .map((folder) => ({
        folder,
        match: fuzzySearch(folderLocation(folder)),
      }))
      .filter((entry) => entry.match !== null)
      .sort((left, right) =>
        (right.match?.score ?? 0) - (left.match?.score ?? 0),
      )
      .map((entry) => entry.folder);
  }

  public override renderSuggestion(folder: TFolder, el: HTMLElement): void {
    const location = folderLocation(folder);
    el.createDiv({
      cls: "dtcu-folder-suggestion-title",
      text: location === "/" ? "Vault root" : folder.name,
    });
    el.createDiv({
      cls: "dtcu-folder-suggestion-path",
      text: location,
    });
  }
}

class TemplateFolderEditorModal extends Modal {
  private folderSuggest: TemplateFolderInputSuggest | null = null;
  private input: TextComponent | null = null;
  private validationEl: HTMLElement | null = null;

  public constructor(
    app: App,
    private readonly initialLocation: string,
    private readonly excludedLocations: ReadonlySet<string>,
    private readonly saveFolder: (location: string) => void,
  ) {
    super(app);
  }

  public override onOpen(): void {
    this.setTitle(
      this.initialLocation === ""
        ? "Add note template location"
        : "Edit note template location",
    );
    this.contentEl.empty();
    this.modalEl.addClass("dtcu-folder-editor-modal");

    new Setting(this.contentEl)
      .setName("Folder")
      .setDesc(
        "Select a vault folder whose Markdown files are all note templates. Typing searches every folder in the vault.",
      )
      .addText((input) => {
        this.input = input;
        input
          .setPlaceholder("Templates")
          .setValue(this.initialLocation);
        input.inputEl.setAttr("aria-label", "Note template folder");
        this.folderSuggest = new TemplateFolderInputSuggest(
          this.app,
          input.inputEl,
          this.excludedLocations,
        );
        this.folderSuggest.onSelect((folder) => {
          input.setValue(folderLocation(folder));
          this.validationEl?.empty();
        });
        input.inputEl.addEventListener("focus", () => {
          input.inputEl.dispatchEvent(new Event("input", { bubbles: true }));
        });
      });

    this.validationEl = this.contentEl.createDiv({
      cls: "dtcu-folder-validation",
      attr: { "aria-live": "polite" },
    });

    const actions = this.contentEl.createDiv({ cls: "dtcu-modal-actions" });
    new ButtonComponent(actions)
      .setButtonText("Cancel")
      .onClick(() => this.close());
    new ButtonComponent(actions)
      .setButtonText(this.initialLocation === "" ? "Add folder" : "Save")
      .setCta()
      .onClick(() => this.submit());
  }

  public override onClose(): void {
    this.folderSuggest?.close();
    this.folderSuggest = null;
    this.input = null;
    this.validationEl = null;
    this.contentEl.empty();
  }

  private submit(): void {
    const folder = resolveFolder(this.app, this.input?.getValue() ?? "");
    if (folder === null) {
      this.validationEl?.setText("Select an existing vault folder.");
      return;
    }
    const location = folderLocation(folder);
    if (this.excludedLocations.has(location)) {
      this.validationEl?.setText("That folder is already listed.");
      return;
    }
    this.saveFolder(location);
    this.close();
  }
}

export class DynamicTemplateChildrenUpdaterSettingTab extends PluginSettingTab {
  private readonly host: SettingsPluginHost;
  private folderSuggests: TemplateFolderInputSuggest[] = [];
  private templateLocationsOpen = true;

  public constructor(app: App, plugin: SettingsPluginHost) {
    super(app, plugin);
    this.host = plugin;
  }

  public override hide(): void {
    this.closeFolderSuggests();
    super.hide();
  }

  public override getSettingDefinitions(): SettingDefinitionItem<SettingsKey>[] {
    return [
      {
        type: "group",
        heading: "Template discovery",
        items: [
          {
            name: "Note template class property",
            desc: "Top-level property whose internal link selects a note's template. The plugin keeps this property last whenever it rewrites frontmatter.",
            aliases: ["template class", "template property", "class link"],
            control: {
              type: "text",
              key: "noteTemplateClassProperty",
              defaultValue: DEFAULT_SETTINGS.noteTemplateClassProperty,
              placeholder: "Note Template Class",
            },
          },
          {
            name: "Note template locations",
            desc: "Folders whose Markdown files are templates and are never updated as child notes.",
            aliases: ["template folders", "template paths", "discovery folders"],
            render: (setting) => {
              setting.settingEl.empty();
              setting.settingEl.addClass("dtcu-template-locations-setting");
              this.renderTemplateLocations(setting.settingEl);
              return () => this.closeFolderSuggests();
            },
          },
        ],
      },
      {
        type: "group",
        heading: "Update behavior",
        items: [
          {
            name: "Automatically update note template children",
            desc: "After a designated template changes, update its linked child notes after the debounce interval. Disabled by default so the initial baseline can be reviewed first.",
            aliases: ["automatic sync", "auto update", "background update"],
            control: {
              type: "toggle",
              key: "automaticallyUpdateChildren",
              defaultValue: DEFAULT_SETTINGS.automaticallyUpdateChildren,
            },
          },
          {
            name: "Apply given default property key updates to existing child notes with non-default property keys",
            desc: "Reapply the current projected property names, hierarchy, and order to matched fields, even when a child customized them or the template itself has not changed. Enabled by default.",
            aliases: ["property names", "property hierarchy", "property order"],
            control: {
              type: "toggle",
              key: "applyPropertyKeyUpdatesToNonDefaultKeys",
              defaultValue:
                DEFAULT_SETTINGS.applyPropertyKeyUpdatesToNonDefaultKeys,
            },
          },
          {
            name: "Apply given default property value updates to existing child notes with non-default property values",
            desc: "Reapply current projected property values to matched fields, overwriting non-default child values even when the template itself has not changed. Disabled by default; key updates can still carry child values forward.",
            aliases: ["property defaults", "property values", "frontmatter values"],
            control: {
              type: "toggle",
              key: "applyPropertyValueUpdatesToNonDefaultValues",
              defaultValue:
                DEFAULT_SETTINGS.applyPropertyValueUpdatesToNonDefaultValues,
            },
          },
          {
            name: "Apply given default heading updates to existing child notes with non-default heading values",
            desc: "Reapply current projected heading names, levels, hierarchy, and order to matched headings, even when a child customized them or the template itself has not changed. Enabled by default.",
            aliases: ["heading names", "heading levels", "heading hierarchy"],
            control: {
              type: "toggle",
              key: "applyHeadingUpdatesToNonDefaultHeadings",
              defaultValue:
                DEFAULT_SETTINGS.applyHeadingUpdatesToNonDefaultHeadings,
            },
          },
          {
            name: "Apply given default body text updates for a heading to existing child notes with non-default body text",
            desc: "Reapply current projected body text to matched sections, overwriting non-default child text even when the template itself has not changed. Disabled by default.",
            aliases: ["section text", "body defaults", "heading body"],
            control: {
              type: "toggle",
              key: "applyBodyTextUpdatesToNonDefaultBody",
              defaultValue:
                DEFAULT_SETTINGS.applyBodyTextUpdatesToNonDefaultBody,
            },
          },
          {
            name: "Automatic update debounce",
            desc: "Milliseconds to wait after a template edit before synchronizing children.",
            aliases: ["update delay", "sync delay", "milliseconds"],
            control: {
              type: "number",
              key: "updateDebounceMilliseconds",
              defaultValue: DEFAULT_SETTINGS.updateDebounceMilliseconds,
              placeholder: "1000",
              min: 250,
              max: 60_000,
              step: 1,
              validate: (value) =>
                Number.isInteger(value) && value >= 250 && value <= 60_000
                  ? undefined
                  : "Enter a whole number from 250 through 60000.",
            },
          },
        ],
      },
      {
        type: "group",
        heading: "Update reports",
        items: [
          {
            name: "Show detailed changes in manual update report",
            desc: "Add one collapsed section per changed child note to the report, including the property, heading, and body-text updates made to that note.",
            aliases: ["change details", "manual report", "updated notes"],
            control: {
              type: "toggle",
              key: "showDetailedChangesInManualUpdateReport",
              defaultValue:
                DEFAULT_SETTINGS.showDetailedChangesInManualUpdateReport,
            },
          },
          {
            name: "Maximum amount of changed notes to display in this report",
            desc: "Limits the detailed changed-note sections while preserving the complete summary and all reported errors.",
            aliases: ["report limit", "maximum changed notes", "change count"],
            render: (setting) => this.renderMaximumChangedNotesSetting(setting),
          },
        ],
      },
      {
        type: "group",
        heading: "Templater projection",
        items: [
          {
            name: "Templater expression defaults",
            desc: "Advanced JSON object mapping an exact expression (without ${…} or <%…%>) to its static default. Built-in rules already cover listBlock, parsed.edited, coverImageBlock, sourceFileUrlsBlock, noteTitle, and common empty ternaries.",
            aliases: ["projection replacements", "static defaults", "advanced JSON"],
            render: (setting) => {
              setting
                .setClass("dtcu-setting-textarea")
                .addTextArea((text) => {
                  text
                    .setPlaceholder(
                      '{\n  "customExpression": "default output"\n}',
                    )
                    .setValue(
                      this.host.settings.templaterExpressionDefaultsJson,
                    )
                    .onChange((value) => {
                      void this.setControlValue(
                        "templaterExpressionDefaultsJson",
                        value,
                      );
                    });
                });
            },
          },
        ],
      },
    ];
  }

  public override getControlValue(key: string): unknown {
    if (!SETTINGS_KEYS.has(key)) {
      return undefined;
    }
    return this.host.settings[key as SettingsKey];
  }

  public override async setControlValue(
    key: string,
    value: unknown,
  ): Promise<void> {
    switch (key) {
      case "noteTemplateClassProperty":
        if (typeof value !== "string") {
          return;
        }
        this.host.settings.noteTemplateClassProperty = value.trim();
        break;
      case "updateDebounceMilliseconds":
        if (typeof value !== "number" || !Number.isFinite(value)) {
          return;
        }
        this.host.settings.updateDebounceMilliseconds = Math.round(
          clamp(value, 250, 60_000),
        );
        break;
      case "templaterExpressionDefaultsJson":
        if (typeof value !== "string") {
          return;
        }
        this.host.settings.templaterExpressionDefaultsJson = value;
        break;
      case "automaticallyUpdateChildren":
      case "applyPropertyKeyUpdatesToNonDefaultKeys":
      case "applyPropertyValueUpdatesToNonDefaultValues":
      case "applyHeadingUpdatesToNonDefaultHeadings":
      case "applyBodyTextUpdatesToNonDefaultBody":
      case "showDetailedChangesInManualUpdateReport":
        if (typeof value !== "boolean") {
          return;
        }
        this.host.settings[key] = value;
        break;
      default:
        return;
    }

    const reportOnly = key === "showDetailedChangesInManualUpdateReport";
    await this.host.saveSettings(!reportOnly);
    if (reportOnly) {
      this.update();
    }
  }

  private renderTemplateLocations(containerEl: HTMLElement): void {
    const panel = containerEl.createEl("details", {
      cls: "dtcu-template-locations-panel",
    });
    panel.open = this.templateLocationsOpen;
    panel.addEventListener("toggle", () => {
      this.templateLocationsOpen = panel.open;
    });

    const summary = panel.createEl("summary", {
      cls: "dtcu-template-locations-summary",
    });
    const summaryText = summary.createDiv({
      cls: "dtcu-template-locations-summary-text",
    });
    summaryText.createDiv({
      cls: "dtcu-template-locations-title",
      text: "Note template locations",
    });
    summaryText.createDiv({
      cls: "dtcu-template-locations-description",
      text: "Files in these folders are templates and are never updated as child notes. Use only if every Markdown file in a listed folder is a template.",
    });
    const addButton = summary.createEl("button", {
      cls: ["clickable-icon", "dtcu-template-location-add"],
      attr: {
        "aria-label": "Add note template folder",
        type: "button",
      },
    });
    setIcon(addButton, "plus");
    addButton.addEventListener("click", (event) => {
      event.preventDefault();
      event.stopPropagation();
      this.openFolderEditor(null);
    });

    const listEl = panel.createDiv({ cls: "dtcu-template-location-list" });
    const locations = this.host.settings.noteTemplateLocations;
    if (locations.length === 0) {
      listEl.createDiv({
        cls: "dtcu-template-location-empty",
        text: "No template folders configured. Use + to add one.",
      });
      return;
    }

    locations.forEach((location, index) => {
      const row = listEl.createDiv({
        cls: "dtcu-template-location-row",
        attr: { "data-location-index": String(index) },
      });
      const input = new TextComponent(row);
      input
        .setPlaceholder("Templates")
        .setValue(location);
      input.inputEl.setAttr(
        "aria-label",
        `Note template folder ${index + 1}`,
      );
      const suggest = new TemplateFolderInputSuggest(
        this.app,
        input.inputEl,
        this.excludedLocations(index),
      );
      suggest.onSelect((folder) => {
        const selected = folderLocation(folder);
        input.setValue(selected);
        void this.chooseTemplateLocation(index, selected);
      });
      this.folderSuggests.push(suggest);
      input.inputEl.addEventListener("focus", () => {
        input.inputEl.dispatchEvent(new Event("input", { bubbles: true }));
      });
      input.inputEl.addEventListener("change", () => {
        void this.commitTypedLocation(index, input.getValue());
      });
      input.inputEl.addEventListener("keydown", (event) => {
        if (event.key === "Enter") {
          event.preventDefault();
          void this.commitTypedLocation(index, input.getValue());
        }
      });

      new ExtraButtonComponent(row)
        .setIcon("folder-search")
        .setTooltip("Search and select folder")
        .onClick(() => this.openFolderEditor(index));
      new ExtraButtonComponent(row)
        .setIcon("x")
        .setTooltip("Remove folder")
        .onClick(() => {
          void this.removeTemplateLocation(index);
        });
      const dragHandle = new ExtraButtonComponent(row)
        .setIcon("grip-vertical")
        .setTooltip("Drag to reorder folders");
      this.configureDragHandle(row, dragHandle, index);
    });
  }

  private renderMaximumChangedNotesSetting(setting: Setting): void {
    let numberInput: TextComponent | null = null;
    let sliderInput: SliderComponent | null = null;
    setting
      .setClass("dtcu-report-limit-setting")
      .setDisabled(
        !this.host.settings.showDetailedChangesInManualUpdateReport,
      )
      .addExtraButton((button) => {
        button
          .setIcon("rotate-ccw")
          .setTooltip(
            `Reset to ${DEFAULT_MAXIMUM_CHANGED_NOTES_IN_REPORT}`,
          )
          .onClick(() => {
            void this.setMaximumChangedNotes(
              DEFAULT_MAXIMUM_CHANGED_NOTES_IN_REPORT,
              numberInput,
              sliderInput,
            );
          });
      })
      .addText((input) => {
        numberInput = input;
        input
          .setValue(
            String(this.host.settings.maximumChangedNotesInReport),
          )
          .onChange((value) => {
            if (value.trim() === "") {
              return;
            }
            const parsed = Number.parseInt(value, 10);
            if (Number.isFinite(parsed)) {
              void this.setMaximumChangedNotes(
                parsed,
                numberInput,
                sliderInput,
              );
            }
          });
        input.inputEl.type = "number";
        input.inputEl.min = String(MINIMUM_CHANGED_NOTES_IN_REPORT);
        input.inputEl.max = String(MAXIMUM_CHANGED_NOTES_IN_REPORT);
        input.inputEl.step = "1";
        input.inputEl.setAttr(
          "aria-label",
          "Maximum changed notes in update report",
        );
      })
      .addSlider((slider) => {
        sliderInput = slider;
        slider
          .setLimits(
            MINIMUM_CHANGED_NOTES_IN_REPORT,
            MAXIMUM_CHANGED_NOTES_IN_REPORT,
            1,
          )
          .setInstant(true)
          .setValue(this.host.settings.maximumChangedNotesInReport)
          .onChange((value) => {
            void this.setMaximumChangedNotes(
              value,
              numberInput,
              sliderInput,
            );
          });
      });
    setting.controlEl.addClass("dtcu-number-slider-control");
  }

  private excludedLocations(index: number | null): Set<string> {
    return new Set(
      this.host.settings.noteTemplateLocations
        .filter((_location, locationIndex) => locationIndex !== index)
        .map(normalizeFolderLocation)
        .filter(Boolean),
    );
  }

  private openFolderEditor(index: number | null): void {
    const initial =
      index === null
        ? ""
        : this.host.settings.noteTemplateLocations[index] ?? "";
    new TemplateFolderEditorModal(
      this.app,
      initial,
      this.excludedLocations(index),
      (location) => {
        void this.chooseTemplateLocation(index, location);
      },
    ).open();
  }

  private async commitTypedLocation(
    index: number,
    value: string,
  ): Promise<void> {
    const folder = resolveFolder(this.app, value);
    if (folder === null) {
      new Notice("Select an existing vault folder.");
      this.update();
      return;
    }
    const location = folderLocation(folder);
    if (this.excludedLocations(index).has(location)) {
      new Notice("That template folder is already listed.");
      this.update();
      return;
    }
    await this.chooseTemplateLocation(index, location);
  }

  private async chooseTemplateLocation(
    index: number | null,
    location: string,
  ): Promise<void> {
    const locations = [...this.host.settings.noteTemplateLocations];
    if (index === null) {
      locations.push(location);
    } else {
      locations[index] = location;
    }
    this.host.settings.noteTemplateLocations = locations;
    await this.host.saveSettings();
    this.update();
  }

  private async removeTemplateLocation(index: number): Promise<void> {
    this.host.settings.noteTemplateLocations =
      this.host.settings.noteTemplateLocations.filter(
        (_location, locationIndex) => locationIndex !== index,
      );
    await this.host.saveSettings();
    this.update();
  }

  private configureDragHandle(
    row: HTMLElement,
    handle: ExtraButtonComponent,
    index: number,
  ): void {
    handle.extraSettingsEl.draggable = true;
    handle.extraSettingsEl.setAttr("role", "button");
    handle.extraSettingsEl.setAttr("tabindex", "0");
    handle.extraSettingsEl.addEventListener("dragstart", (event) => {
      event.dataTransfer?.setData("text/plain", String(index));
      if (event.dataTransfer !== null) {
        event.dataTransfer.effectAllowed = "move";
      }
      row.addClass("is-dragging");
    });
    handle.extraSettingsEl.addEventListener("dragend", () => {
      row.removeClass("is-dragging");
      this.clearDragTargets();
    });
    handle.extraSettingsEl.addEventListener("keydown", (event) => {
      if (event.key !== "ArrowUp" && event.key !== "ArrowDown") {
        return;
      }
      event.preventDefault();
      const target = event.key === "ArrowUp" ? index - 1 : index + 1;
      if (
        target >= 0 &&
        target < this.host.settings.noteTemplateLocations.length
      ) {
        void this.moveTemplateLocation(index, target);
      }
    });
    row.addEventListener("dragover", (event) => {
      event.preventDefault();
      row.addClass("is-drag-target");
      if (event.dataTransfer !== null) {
        event.dataTransfer.dropEffect = "move";
      }
    });
    row.addEventListener("dragleave", () => {
      row.removeClass("is-drag-target");
    });
    row.addEventListener("drop", (event) => {
      event.preventDefault();
      const source = Number.parseInt(
        event.dataTransfer?.getData("text/plain") ?? "",
        10,
      );
      this.clearDragTargets();
      if (Number.isInteger(source) && source !== index) {
        void this.moveTemplateLocation(source, index);
      }
    });
  }

  private async moveTemplateLocation(
    sourceIndex: number,
    targetIndex: number,
  ): Promise<void> {
    const locations = [...this.host.settings.noteTemplateLocations];
    const [moved] = locations.splice(sourceIndex, 1);
    if (moved === undefined) {
      return;
    }
    locations.splice(targetIndex, 0, moved);
    this.host.settings.noteTemplateLocations = locations;
    await this.host.saveSettings();
    this.update();
  }

  private clearDragTargets(): void {
    this.containerEl
      .querySelectorAll(".dtcu-template-location-row.is-drag-target")
      .forEach((row) => row.removeClass("is-drag-target"));
  }

  private async setMaximumChangedNotes(
    value: number,
    numberInput: TextComponent | null,
    sliderInput: SliderComponent | null,
  ): Promise<void> {
    const normalized = Math.round(
      clamp(
        value,
        MINIMUM_CHANGED_NOTES_IN_REPORT,
        MAXIMUM_CHANGED_NOTES_IN_REPORT,
      ),
    );
    this.host.settings.maximumChangedNotesInReport = normalized;
    if (numberInput?.getValue() !== String(normalized)) {
      numberInput?.setValue(String(normalized));
    }
    if (sliderInput?.getValue() !== normalized) {
      sliderInput?.setValue(normalized);
    }
    await this.host.saveSettings(false);
  }

  private closeFolderSuggests(): void {
    for (const suggest of this.folderSuggests) {
      suggest.close();
    }
    this.folderSuggests = [];
  }
}
