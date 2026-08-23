import {
  Notice,
  Plugin,
  TFile,
} from "obsidian";
import {
  ProjectionPreviewModal,
  summarizeReport,
  SyncReportModal,
} from "./modals";
import { DynamicTemplateChildrenUpdaterSettingTab } from "./settings";
import {
  TemplateSyncService,
  type SyncServiceHost,
} from "./sync-service";
import {
  DATA_VERSION,
  DEFAULT_SETTINGS,
  MAXIMUM_CHANGED_NOTES_IN_REPORT,
  MINIMUM_CHANGED_NOTES_IN_REPORT,
  type DynamicTemplateChildrenUpdaterSettings,
  type PersistedPluginData,
  type SyncReport,
  type TemplateSnapshot,
} from "./types";
import { clamp, isDataMap } from "./utils";

function numberSetting(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function booleanSetting(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function stringSetting(value: unknown, fallback: string): string {
  return typeof value === "string" ? value : fallback;
}

export default class DynamicTemplateChildrenUpdaterPlugin
  extends Plugin
  implements SyncServiceHost
{
  public override settings: DynamicTemplateChildrenUpdaterSettings = {
    ...DEFAULT_SETTINGS,
  };
  public snapshots: Record<string, TemplateSnapshot> = {};
  private syncService!: TemplateSyncService;
  private settingsReconcileTimer: number | null = null;

  public override async onload(): Promise<void> {
    await this.loadPluginData();
    this.syncService = new TemplateSyncService(this);
    this.addSettingTab(
      new DynamicTemplateChildrenUpdaterSettingTab(this.app, this),
    );

    this.addCommand({
      id: "manually-update-note-template-children",
      name: "Manually update note template children",
      callback: () => {
        this.runBackground(this.runManualUpdate());
      },
    });

    this.addCommand({
      id: "preview-projected-template-defaults",
      name: "Preview projected defaults for active note template",
      checkCallback: (checking) => {
        const activeFile = this.app.workspace.getActiveFile();
        const available =
          activeFile instanceof TFile && this.syncService.isTemplate(activeFile);
        if (available && !checking && activeFile !== null) {
          this.runBackground(this.openProjectionPreview(activeFile));
        }
        return available;
      },
    });

    this.registerEvent(
      this.app.vault.on("modify", (file) => {
        this.syncService.scheduleTemplateUpdate(file);
      }),
    );
    this.registerEvent(
      this.app.vault.on("create", (file) => {
        if (file instanceof TFile) {
          this.syncService.scheduleTemplateUpdate(file);
        }
      }),
    );
    this.registerEvent(
      this.app.vault.on("rename", (file, oldPath) => {
        this.runBackground(this.syncService.handleRename(file, oldPath));
      }),
    );
    this.registerEvent(
      this.app.vault.on("delete", (file) => {
        this.runBackground(this.syncService.handleDelete(file));
      }),
    );

    this.app.workspace.onLayoutReady(() => {
      this.runBackground(
        this.syncService.initialize().then((report) => {
          this.presentStartupReport(report);
        }),
      );
    });
  }

  public override onunload(): void {
    if (this.settingsReconcileTimer !== null) {
      window.clearTimeout(this.settingsReconcileTimer);
      this.settingsReconcileTimer = null;
    }
    this.syncService.dispose();
  }

  public async persistData(): Promise<void> {
    const data: PersistedPluginData = {
      dataVersion: DATA_VERSION,
      settings: this.settings,
      snapshots: this.snapshots,
    };
    await this.saveData(data);
  }

  public async saveSettings(reconcile = true): Promise<void> {
    await this.persistData();
    if (!reconcile) {
      return;
    }
    if (this.settingsReconcileTimer !== null) {
      window.clearTimeout(this.settingsReconcileTimer);
    }
    this.settingsReconcileTimer = window.setTimeout(() => {
      this.settingsReconcileTimer = null;
      this.runBackground(
        this.syncService.reconcileAfterSettingsChange().then((report) => {
          this.onBackgroundReport(report);
        }),
      );
    }, 750);
  }

  public onBackgroundReport(report: SyncReport): void {
    const updated = report.templates
      .flatMap((template) => template.children)
      .some((child) => child.status === "updated");
    const failed = report.templates.some(
      (template) =>
        template.status === "error" ||
        template.children.some((child) => child.status === "error"),
    );
    if (updated || failed) {
      new Notice(summarizeReport(report), failed ? 10_000 : 5_000);
    }
  }

  public onBackgroundError(message: string): void {
    new Notice(`Dynamic Template Children Updater: ${message}`, 10_000);
  }

  private async loadPluginData(): Promise<void> {
    const raw: unknown = await this.loadData();
    if (!isDataMap(raw)) {
      return;
    }
    const rawSettings = isDataMap(raw.settings) ? raw.settings : {};
    const locations = Array.isArray(rawSettings.noteTemplateLocations)
      ? rawSettings.noteTemplateLocations.filter(
          (value): value is string => typeof value === "string",
        )
      : DEFAULT_SETTINGS.noteTemplateLocations;

    this.settings = {
      noteTemplateClassProperty: stringSetting(
        rawSettings.noteTemplateClassProperty,
        DEFAULT_SETTINGS.noteTemplateClassProperty,
      ),
      noteTemplateLocations: locations,
      automaticallyUpdateChildren: booleanSetting(
        rawSettings.automaticallyUpdateChildren,
        DEFAULT_SETTINGS.automaticallyUpdateChildren,
      ),
      applyPropertyKeyUpdatesToNonDefaultKeys: booleanSetting(
        rawSettings.applyPropertyKeyUpdatesToNonDefaultKeys,
        booleanSetting(
          rawSettings.applyPropertyKeyChangesToNonDefaultKeys,
          DEFAULT_SETTINGS.applyPropertyKeyUpdatesToNonDefaultKeys,
        ),
      ),
      applyPropertyValueUpdatesToNonDefaultValues: booleanSetting(
        rawSettings.applyPropertyValueUpdatesToNonDefaultValues,
        booleanSetting(
          rawSettings.applyPropertyValueChangesToNonDefaultValues,
          DEFAULT_SETTINGS.applyPropertyValueUpdatesToNonDefaultValues,
        ),
      ),
      applyHeadingUpdatesToNonDefaultHeadings: booleanSetting(
        rawSettings.applyHeadingUpdatesToNonDefaultHeadings,
        booleanSetting(
          rawSettings.applyHeadingChangesToNonDefaultHeadings,
          DEFAULT_SETTINGS.applyHeadingUpdatesToNonDefaultHeadings,
        ),
      ),
      applyBodyTextUpdatesToNonDefaultBody: booleanSetting(
        rawSettings.applyBodyTextUpdatesToNonDefaultBody,
        booleanSetting(
          rawSettings.applyBodyTextChangesToNonDefaultBody,
          DEFAULT_SETTINGS.applyBodyTextUpdatesToNonDefaultBody,
        ),
      ),
      showDetailedChangesInManualUpdateReport: booleanSetting(
        rawSettings.showDetailedChangesInManualUpdateReport,
        DEFAULT_SETTINGS.showDetailedChangesInManualUpdateReport,
      ),
      maximumChangedNotesInReport: Math.round(
        clamp(
          numberSetting(
            rawSettings.maximumChangedNotesInReport,
            DEFAULT_SETTINGS.maximumChangedNotesInReport,
          ),
          MINIMUM_CHANGED_NOTES_IN_REPORT,
          MAXIMUM_CHANGED_NOTES_IN_REPORT,
        ),
      ),
      updateDebounceMilliseconds: numberSetting(
        rawSettings.updateDebounceMilliseconds,
        DEFAULT_SETTINGS.updateDebounceMilliseconds,
      ),
      templaterExpressionDefaultsJson: stringSetting(
        rawSettings.templaterExpressionDefaultsJson,
        DEFAULT_SETTINGS.templaterExpressionDefaultsJson,
      ),
    };

    if (isDataMap(raw.snapshots)) {
      for (const [path, value] of Object.entries(raw.snapshots)) {
        if (
          isDataMap(value) &&
          typeof value.path === "string" &&
          typeof value.projectedMarkdown === "string" &&
          typeof value.sourceHash === "string" &&
          typeof value.recordedAt === "number"
        ) {
          this.snapshots[path] = {
            dataVersion: numberSetting(value.dataVersion, DATA_VERSION),
            path: value.path,
            projectedMarkdown: value.projectedMarkdown,
            sourceHash: value.sourceHash,
            recordedAt: value.recordedAt,
          };
        }
      }
    }
  }

  private async runManualUpdate(): Promise<void> {
    const report = await this.syncService.manuallyUpdateForContext(
      this.app.workspace.getActiveFile(),
    );
    new SyncReportModal(
      this.app,
      report,
      this.settings.showDetailedChangesInManualUpdateReport,
      this.settings.maximumChangedNotesInReport,
    ).open();
  }

  private async openProjectionPreview(file: TFile): Promise<void> {
    try {
      const projection = await this.syncService.preview(file);
      new ProjectionPreviewModal(this.app, file.path, projection).open();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      new Notice(`Could not project the template: ${message}`, 10_000);
    }
  }

  private presentStartupReport(report: SyncReport): void {
    const pending = report.templates.filter(
      (template) => template.message?.includes("pending projected changes") === true,
    ).length;
    const failed = report.templates.filter(
      (template) => template.status === "error",
    ).length;
    if (failed > 0) {
      new Notice(`${failed} template updates failed during startup.`, 10_000);
    } else if (pending > 0) {
      new Notice(
        `${pending} templates have pending changes. Run “Manually update note template children” to apply them.`,
        7_000,
      );
    }
  }

  private runBackground(operation: Promise<unknown>): void {
    void operation.catch((error: unknown) => {
      const message = error instanceof Error ? error.message : String(error);
      this.onBackgroundError(message);
    });
  }
}
