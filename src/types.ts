export const DATA_VERSION = 3;

export const DEFAULT_MAXIMUM_CHANGED_NOTES_IN_REPORT = 25;
export const MINIMUM_CHANGED_NOTES_IN_REPORT = 1;
export const MAXIMUM_CHANGED_NOTES_IN_REPORT = 500;

export interface TemplateSnapshot {
  dataVersion: number;
  path: string;
  projectedMarkdown: string;
  sourceHash: string;
  recordedAt: number;
}

export interface DynamicTemplateChildrenUpdaterSettings {
  noteTemplateClassProperty: string;
  noteTemplateLocations: string[];
  automaticallyUpdateChildren: boolean;
  applyPropertyKeyUpdatesToNonDefaultKeys: boolean;
  applyPropertyValueUpdatesToNonDefaultValues: boolean;
  applyHeadingUpdatesToNonDefaultHeadings: boolean;
  applyBodyTextUpdatesToNonDefaultBody: boolean;
  showDetailedChangesInManualUpdateReport: boolean;
  maximumChangedNotesInReport: number;
  updateDebounceMilliseconds: number;
  templaterExpressionDefaultsJson: string;
}

export interface PersistedPluginData {
  dataVersion: number;
  settings: DynamicTemplateChildrenUpdaterSettings;
  snapshots: Record<string, TemplateSnapshot>;
}

export const DEFAULT_SETTINGS: DynamicTemplateChildrenUpdaterSettings = {
  noteTemplateClassProperty: "Note Template Class",
  noteTemplateLocations: ["Templates"],
  automaticallyUpdateChildren: false,
  applyPropertyKeyUpdatesToNonDefaultKeys: true,
  applyPropertyValueUpdatesToNonDefaultValues: false,
  applyHeadingUpdatesToNonDefaultHeadings: true,
  applyBodyTextUpdatesToNonDefaultBody: false,
  showDetailedChangesInManualUpdateReport: true,
  maximumChangedNotesInReport: DEFAULT_MAXIMUM_CHANGED_NOTES_IN_REPORT,
  updateDebounceMilliseconds: 1_000,
  templaterExpressionDefaultsJson: "{}",
};

export type TemplateSourceKind = "core-templates" | "templater" | "markdown";

export interface ProjectionDiagnostic {
  expression?: string;
  message: string;
  severity: "info" | "warning" | "error";
}

export interface TemplateProjection {
  internalMarkdown: string;
  previewMarkdown: string;
  diagnostics: ProjectionDiagnostic[];
  sourceKind: TemplateSourceKind;
}

export interface MergeConflict {
  path: string;
  message: string;
}

export interface ChildUpdateChange {
  category: "property" | "heading" | "body";
  description: string;
}

export interface FrontmatterMergeOptions {
  applyKeyUpdatesToNonDefaultKeys: boolean;
  applyValueUpdatesToNonDefaultValues: boolean;
  classPropertyKey: string;
  dynamicValues: Record<string, unknown>;
}

export interface MarkdownMergeOptions {
  applyHeadingUpdatesToNonDefaultHeadings: boolean;
  applyBodyUpdatesToNonDefaultBody: boolean;
  dynamicValues: Record<string, unknown>;
}

export interface MergeResult<T> {
  value: T;
  changed: boolean;
  conflicts: MergeConflict[];
}

export interface ChildUpdateResult {
  path: string;
  status: "updated" | "unchanged" | "skipped" | "error";
  changes: ChildUpdateChange[];
  conflicts: MergeConflict[];
  message?: string;
}

export interface TemplateUpdateResult {
  templatePath: string;
  status: "updated" | "unchanged" | "initialized" | "error";
  children: ChildUpdateResult[];
  diagnostics: ProjectionDiagnostic[];
  message?: string;
}

export interface SyncReport {
  reason: "automatic" | "manual" | "startup" | "settings";
  templates: TemplateUpdateResult[];
  startedAt: number;
  finishedAt: number;
}
