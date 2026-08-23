import {
  App,
  normalizePath,
  TAbstractFile,
  TFile,
} from "obsidian";
import { splitMarkdownDocument, parseFrontmatterMap, replaceMarkdownBody } from "./frontmatter";
import { describeFrontmatterChanges } from "./change-report";
import { mergeFrontmatter } from "./frontmatter-merge";
import {
  describeMarkdownChanges,
  mergeMarkdownBody,
} from "./markdown-merge";
import { projectTemplate } from "./projector";
import type {
  ChildUpdateResult,
  DynamicTemplateChildrenUpdaterSettings,
  SyncReport,
  TemplateProjection,
  TemplateSnapshot,
  TemplateUpdateResult,
} from "./types";
import { DATA_VERSION } from "./types";
import { isDataMap, stableHash, type DataMap } from "./utils";

export interface SyncServiceHost {
  app: App;
  settings: DynamicTemplateChildrenUpdaterSettings;
  snapshots: Record<string, TemplateSnapshot>;
  onBackgroundError(message: string): void;
  onBackgroundReport(report: SyncReport): void;
  persistData(): Promise<void>;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isMarkdownFile(file: TAbstractFile): file is TFile {
  return file instanceof TFile && file.extension.toLocaleLowerCase() === "md";
}

function templateResult(
  templatePath: string,
  status: TemplateUpdateResult["status"],
  projection: TemplateProjection,
  message?: string,
): TemplateUpdateResult {
  return {
    templatePath,
    status,
    children: [],
    diagnostics: projection.diagnostics,
    ...(message === undefined ? {} : { message }),
  };
}

export class TemplateSyncService {
  private readonly host: SyncServiceHost;
  private readonly updateTimers = new Map<string, number>();
  private ready = false;
  private operationChain: Promise<void> = Promise.resolve();

  public constructor(host: SyncServiceHost) {
    this.host = host;
  }

  public async initialize(): Promise<SyncReport> {
    this.ready = true;
    return this.enqueue(async () => {
      const templates = this.discoverTemplates();
      const results: TemplateUpdateResult[] = [];
      const knownPaths = new Set(templates.map((file) => file.path));

      for (const path of Object.keys(this.host.snapshots)) {
        if (!knownPaths.has(path)) {
          delete this.host.snapshots[path];
        }
      }

      for (const template of templates) {
        const result = await this.syncTemplateInternal(
          template,
          "startup",
          this.host.settings.automaticallyUpdateChildren,
          false,
          null,
        );
        results.push(result);
      }
      await this.host.persistData();
      return this.makeReport("startup", results);
    });
  }

  public dispose(): void {
    this.ready = false;
    for (const timer of this.updateTimers.values()) {
      window.clearTimeout(timer);
    }
    this.updateTimers.clear();
  }

  public isTemplate(file: TFile): boolean {
    if (file.extension.toLocaleLowerCase() !== "md") {
      return false;
    }

    return this.normalizedTemplateLocations().some((location) => {
      return location === "" || file.path.startsWith(`${location}/`);
    });
  }

  public scheduleTemplateUpdate(file: TAbstractFile): void {
    if (
      !this.ready ||
      !this.host.settings.automaticallyUpdateChildren ||
      !isMarkdownFile(file) ||
      !this.isTemplate(file)
    ) {
      return;
    }

    const existing = this.updateTimers.get(file.path);
    if (existing !== undefined) {
      window.clearTimeout(existing);
    }
    const timer = window.setTimeout(() => {
      this.updateTimers.delete(file.path);
      void this.syncTemplates([file], "automatic", true, false).then((report) => {
        this.host.onBackgroundReport(report);
      }).catch((error: unknown) => {
        this.host.onBackgroundError(errorMessage(error));
      });
    }, this.host.settings.updateDebounceMilliseconds);
    this.updateTimers.set(file.path, timer);
  }

  public async handleRename(file: TAbstractFile, oldPath: string): Promise<void> {
    const timer = this.updateTimers.get(oldPath);
    if (timer !== undefined) {
      window.clearTimeout(timer);
      this.updateTimers.delete(oldPath);
    }

    const snapshot = this.host.snapshots[oldPath];
    if (snapshot !== undefined) {
      delete this.host.snapshots[oldPath];
      if (isMarkdownFile(file) && this.isTemplate(file)) {
        this.host.snapshots[file.path] = { ...snapshot, path: file.path };
      }
      await this.host.persistData();
    } else if (isMarkdownFile(file) && this.isTemplate(file) && this.ready) {
      await this.establishSnapshot(file);
    }
  }

  public async handleDelete(file: TAbstractFile): Promise<void> {
    if (this.host.snapshots[file.path] !== undefined) {
      delete this.host.snapshots[file.path];
      await this.host.persistData();
    }
  }

  public async reconcileAfterSettingsChange(): Promise<SyncReport> {
    if (!this.ready) {
      return this.makeReport("settings", []);
    }
    return this.enqueue(async () => {
      const templates = this.discoverTemplates();
      const results: TemplateUpdateResult[] = [];
      for (const template of templates) {
        const result = await this.syncTemplateInternal(
          template,
          "settings",
          this.host.settings.automaticallyUpdateChildren,
          false,
          null,
        );
        results.push(result);
      }
      await this.host.persistData();
      return this.makeReport("settings", results);
    });
  }

  public async manuallyUpdateForContext(
    activeFile: TFile | null,
  ): Promise<SyncReport> {
    if (activeFile !== null && this.isTemplate(activeFile)) {
      return this.syncTemplates([activeFile], "manual", true, true);
    }

    if (activeFile !== null) {
      const template = this.resolveTemplateForChild(activeFile);
      if (template !== null) {
        return this.syncTemplates([template], "manual", true, true);
      }
    }

    return this.syncTemplates(this.discoverTemplates(), "manual", true, true);
  }

  public async preview(file: TFile): Promise<TemplateProjection> {
    const source = await this.host.app.vault.cachedRead(file);
    return projectTemplate(
      source,
      this.host.settings.templaterExpressionDefaultsJson,
    );
  }

  private normalizedTemplateLocations(): string[] {
    return this.host.settings.noteTemplateLocations
      .map((location) => location.trim())
      .filter(Boolean)
      .map((location) =>
        location === "/"
          ? ""
          : normalizePath(location.replace(/^\/+|\/+$/gu, "")),
      )
      .filter(
        (location, index, locations) => locations.indexOf(location) === index,
      );
  }

  private discoverTemplates(): TFile[] {
    return this.host.app.vault
      .getMarkdownFiles()
      .filter((file) => this.isTemplate(file))
      .sort((left, right) => left.path.localeCompare(right.path));
  }

  private async establishSnapshot(file: TFile): Promise<TemplateUpdateResult> {
    const source = await this.host.app.vault.cachedRead(file);
    const projection = projectTemplate(
      source,
      this.host.settings.templaterExpressionDefaultsJson,
    );
    if (
      projection.diagnostics.some(
        (diagnostic) => diagnostic.severity === "error",
      )
    ) {
      return templateResult(
        file.path,
        "error",
        projection,
        "The static projection contains errors, so its baseline was not initialized.",
      );
    }
    this.host.snapshots[file.path] = this.createSnapshot(
      file,
      source,
      projection,
    );
    await this.host.persistData();
    return templateResult(file.path, "initialized", projection);
  }

  private createSnapshot(
    file: TFile,
    source: string,
    projection: TemplateProjection,
  ): TemplateSnapshot {
    return {
      dataVersion: DATA_VERSION,
      path: file.path,
      projectedMarkdown: projection.internalMarkdown,
      sourceHash: stableHash(source),
      recordedAt: Date.now(),
    };
  }

  private async syncTemplates(
    templates: TFile[],
    reason: SyncReport["reason"],
    applyUpdates: boolean,
    reapplyCurrentProjection: boolean,
  ): Promise<SyncReport> {
    return this.enqueue(async () => {
      const results: TemplateUpdateResult[] = [];
      const detailedChangeBudget =
        reason === "manual" &&
        this.host.settings.showDetailedChangesInManualUpdateReport
          ? {
              remaining:
                this.host.settings.maximumChangedNotesInReport,
            }
          : null;
      for (const template of templates) {
        results.push(
          await this.syncTemplateInternal(
            template,
            reason,
            applyUpdates,
            reapplyCurrentProjection,
            detailedChangeBudget,
          ),
        );
      }
      await this.host.persistData();
      return this.makeReport(reason, results);
    });
  }

  private async syncTemplateInternal(
    template: TFile,
    reason: SyncReport["reason"],
    applyUpdates: boolean,
    reapplyCurrentProjection: boolean,
    detailedChangeBudget: { remaining: number } | null,
  ): Promise<TemplateUpdateResult> {
    try {
      const source = await this.host.app.vault.cachedRead(template);
      const projection = projectTemplate(
        source,
        this.host.settings.templaterExpressionDefaultsJson,
      );
      const projectionErrors = projection.diagnostics.filter(
        (diagnostic) => diagnostic.severity === "error",
      );
      if (projectionErrors.length > 0) {
        return templateResult(
          template.path,
          "error",
          projection,
          "The static projection contains errors, so no baseline or child note was changed.",
        );
      }
      const previous = this.host.snapshots[template.path];
      if (previous === undefined && !reapplyCurrentProjection) {
        this.host.snapshots[template.path] = this.createSnapshot(
          template,
          source,
          projection,
        );
        return templateResult(template.path, "initialized", projection);
      }

      const previousProjection =
        previous?.projectedMarkdown ?? projection.internalMarkdown;
      const projectionChanged =
        previousProjection !== projection.internalMarkdown;

      if (!projectionChanged && !reapplyCurrentProjection) {
        if (previous !== undefined && previous.sourceHash !== stableHash(source)) {
          this.host.snapshots[template.path] = this.createSnapshot(
            template,
            source,
            projection,
          );
        }
        return templateResult(template.path, "unchanged", projection);
      }

      if (!applyUpdates) {
        return templateResult(
          template.path,
          "unchanged",
          projection,
          "The template has pending projected changes. Automatic updates are disabled.",
        );
      }

      const baseParts = splitMarkdownDocument(previousProjection);
      const nextParts = splitMarkdownDocument(projection.internalMarkdown);
      const baseFrontmatter = parseFrontmatterMap(baseParts.frontmatter);
      const nextFrontmatter = parseFrontmatterMap(nextParts.frontmatter);
      const children = this.findChildren(template);
      const childResults: ChildUpdateResult[] = [];

      for (const child of children) {
        const collectChanges =
          detailedChangeBudget !== null &&
          detailedChangeBudget.remaining > 0;
        const childResult = await this.updateChild(
          child,
          baseFrontmatter,
          nextFrontmatter,
          baseParts.body,
          nextParts.body,
          collectChanges,
        );
        childResults.push(childResult);
        if (collectChanges && childResult.status === "updated") {
          detailedChangeBudget.remaining -= 1;
        }
      }

      const hasErrors = childResults.some((result) => result.status === "error");
      const hasChildUpdates = childResults.some(
        (result) => result.status === "updated",
      );
      if (!hasErrors) {
        this.host.snapshots[template.path] = this.createSnapshot(
          template,
          source,
          projection,
        );
      }

      return {
        templatePath: template.path,
        status: hasErrors
          ? "error"
          : hasChildUpdates || projectionChanged
            ? "updated"
            : previous === undefined
              ? "initialized"
              : "unchanged",
        children: childResults,
        diagnostics: projection.diagnostics,
        ...(hasErrors
          ? {
              message:
                previous === undefined
                  ? "At least one child failed. No baseline was recorded so the manual command can retry safely."
                  : "At least one child failed. The prior baseline was retained so the manual command can retry safely.",
            }
          : {}),
      };
    } catch (error) {
      const emptyProjection: TemplateProjection = {
        diagnostics: [],
        internalMarkdown: "",
        previewMarkdown: "",
        sourceKind: "markdown",
      };
      return templateResult(
        template.path,
        "error",
        emptyProjection,
        errorMessage(error),
      );
    }
  }

  private findChildren(template: TFile): TFile[] {
    return this.host.app.vault
      .getMarkdownFiles()
      .filter((file) => !this.isTemplate(file))
      .filter((file) => this.resolveTemplateForChild(file)?.path === template.path)
      .sort((left, right) => left.path.localeCompare(right.path));
  }

  private resolveTemplateForChild(child: TFile): TFile | null {
    const propertyKey = this.host.settings.noteTemplateClassProperty.trim();
    if (propertyKey === "") {
      return null;
    }
    const frontmatter = this.host.app.metadataCache.getFileCache(child)?.frontmatter;
    if (!isDataMap(frontmatter) || !Object.hasOwn(frontmatter, propertyKey)) {
      return null;
    }

    for (const linkpath of this.extractLinkpaths(frontmatter[propertyKey])) {
      const destination = this.host.app.metadataCache.getFirstLinkpathDest(
        linkpath,
        child.path,
      );
      if (destination !== null && this.isTemplate(destination)) {
        return destination;
      }
    }
    return null;
  }

  private extractLinkpaths(value: unknown): string[] {
    if (Array.isArray(value)) {
      return value.flatMap((item) => this.extractLinkpaths(item));
    }
    if (typeof value !== "string") {
      return [];
    }

    const links: string[] = [];
    const wikiLinkPattern = /\[\[([^\]|#]+)(?:#[^\]|]*)?(?:\|[^\]]*)?\]\]/gu;
    for (const match of value.matchAll(wikiLinkPattern)) {
      const linkpath = match[1]?.trim();
      if (linkpath !== undefined && linkpath !== "") {
        links.push(linkpath);
      }
    }
    if (links.length === 0 && value.trim() !== "") {
      links.push(value.trim());
    }
    return links;
  }

  private async updateChild(
    child: TFile,
    baseFrontmatter: DataMap,
    nextFrontmatter: DataMap,
    baseBody: string,
    nextBody: string,
    collectChanges: boolean,
  ): Promise<ChildUpdateResult> {
    try {
      const initial = await this.host.app.vault.cachedRead(child);
      const initialParts = splitMarkdownDocument(initial);
      const initialFrontmatter = parseFrontmatterMap(initialParts.frontmatter);
      const dynamicValues = {
        date: "",
        digitalPageCount: null,
        time: "",
        title: child.basename,
      };
      const initialFrontmatterMerge = mergeFrontmatter(
        baseFrontmatter,
        nextFrontmatter,
        initialFrontmatter,
        {
          applyKeyUpdatesToNonDefaultKeys:
            this.host.settings.applyPropertyKeyUpdatesToNonDefaultKeys,
          applyValueUpdatesToNonDefaultValues:
            this.host.settings.applyPropertyValueUpdatesToNonDefaultValues,
          classPropertyKey: this.host.settings.noteTemplateClassProperty,
          dynamicValues,
        },
      );
      const bodyMerge = mergeMarkdownBody(baseBody, nextBody, initialParts.body, {
        applyBodyUpdatesToNonDefaultBody:
          this.host.settings.applyBodyTextUpdatesToNonDefaultBody,
        applyHeadingUpdatesToNonDefaultHeadings:
          this.host.settings.applyHeadingUpdatesToNonDefaultHeadings,
        dynamicValues,
      });

      let frontmatterChanged = false;
      let finalFrontmatter = initialFrontmatter;
      let conflicts = [...initialFrontmatterMerge.conflicts, ...bodyMerge.conflicts];
      if (initialFrontmatterMerge.changed) {
        await this.host.app.fileManager.processFrontMatter(
          child,
          (currentFrontmatter: Record<string, unknown>) => {
            const current = isDataMap(currentFrontmatter)
              ? currentFrontmatter
              : {};
            const latestMerge = mergeFrontmatter(
              baseFrontmatter,
              nextFrontmatter,
              current,
              {
                applyKeyUpdatesToNonDefaultKeys:
                  this.host.settings.applyPropertyKeyUpdatesToNonDefaultKeys,
                applyValueUpdatesToNonDefaultValues:
                  this.host.settings.applyPropertyValueUpdatesToNonDefaultValues,
                classPropertyKey: this.host.settings.noteTemplateClassProperty,
                dynamicValues,
              },
            );
            conflicts = [...latestMerge.conflicts, ...bodyMerge.conflicts];
            if (!latestMerge.changed) {
              return;
            }
            this.normalizeClassLinkValue(latestMerge.value);
            finalFrontmatter = latestMerge.value;
            for (const key of Object.keys(currentFrontmatter)) {
              delete currentFrontmatter[key];
            }
            Object.assign(currentFrontmatter, latestMerge.value);
            frontmatterChanged = true;
          },
        );
      }

      let bodyChanged = false;
      let finalBody = initialParts.body;
      if (bodyMerge.changed) {
        await this.host.app.vault.process(child, (currentMarkdown) => {
          const currentParts = splitMarkdownDocument(currentMarkdown);
          const latestBodyMerge = mergeMarkdownBody(
            baseBody,
            nextBody,
            currentParts.body,
            {
              applyBodyUpdatesToNonDefaultBody:
                this.host.settings.applyBodyTextUpdatesToNonDefaultBody,
              applyHeadingUpdatesToNonDefaultHeadings:
                this.host.settings.applyHeadingUpdatesToNonDefaultHeadings,
              dynamicValues,
            },
          );
          if (!latestBodyMerge.changed) {
            return currentMarkdown;
          }
          bodyChanged = true;
          finalBody = latestBodyMerge.value;
          return replaceMarkdownBody(currentMarkdown, latestBodyMerge.value);
        });
      }

      const changes = collectChanges
        ? [
            ...(frontmatterChanged
              ? describeFrontmatterChanges(
                  initialFrontmatter,
                  finalFrontmatter,
                )
              : []),
            ...(bodyChanged
              ? describeMarkdownChanges(initialParts.body, finalBody)
              : []),
          ]
        : [];

      return {
        path: child.path,
        status: frontmatterChanged || bodyChanged ? "updated" : "unchanged",
        changes,
        conflicts,
      };
    } catch (error) {
      return {
        path: child.path,
        status: "error",
        changes: [],
        conflicts: [],
        message: errorMessage(error),
      };
    }
  }

  private normalizeClassLinkValue(frontmatter: DataMap): void {
    const propertyKey = this.host.settings.noteTemplateClassProperty.trim();
    if (propertyKey === "" || !Object.hasOwn(frontmatter, propertyKey)) {
      return;
    }
    const current = frontmatter[propertyKey];
    if (typeof current === "string" && current.includes("[[")) {
      return;
    }
    const linkpaths = this.extractLinkpaths(current);
    if (linkpaths.length === 1 && linkpaths[0] !== undefined) {
      frontmatter[propertyKey] = `[[${linkpaths[0]}]]`;
    } else if (linkpaths.length > 1) {
      frontmatter[propertyKey] = linkpaths.map((linkpath) => `[[${linkpath}]]`);
    }
  }

  private makeReport(
    reason: SyncReport["reason"],
    templates: TemplateUpdateResult[],
  ): SyncReport {
    const now = Date.now();
    return {
      reason,
      templates,
      startedAt: now,
      finishedAt: now,
    };
  }

  private async enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const previous = this.operationChain;
    let release: (() => void) | undefined;
    this.operationChain = new Promise<void>((resolve) => {
      release = resolve;
    });
    await previous;
    try {
      return await operation();
    } finally {
      release?.();
    }
  }
}
