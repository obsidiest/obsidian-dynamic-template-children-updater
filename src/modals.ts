import { App, ButtonComponent, Modal, Notice } from "obsidian";
import type {
  ChildUpdateResult,
  SyncReport,
  TemplateProjection,
} from "./types";

function statusSummary(report: SyncReport): string {
  const children = report.templates.flatMap((template) => template.children);
  const updated = children.filter((child) => child.status === "updated").length;
  const unchanged = children.filter((child) => child.status === "unchanged").length;
  const errors = children.filter((child) => child.status === "error").length;
  const initialized = report.templates.filter(
    (template) => template.status === "initialized",
  ).length;
  return `${updated} child notes updated, ${unchanged} unchanged, ${errors} failed, and ${initialized} template baselines initialized.`;
}

export class ProjectionPreviewModal extends Modal {
  private readonly filePath: string;
  private readonly projection: TemplateProjection;

  public constructor(
    app: App,
    filePath: string,
    projection: TemplateProjection,
  ) {
    super(app);
    this.filePath = filePath;
    this.projection = projection;
  }

  public override onOpen(): void {
    this.setTitle("Projected template defaults");
    this.contentEl.empty();
    this.contentEl.createEl("p", {
      text: `${this.filePath} · ${this.projection.sourceKind}`,
    });

    if (this.projection.diagnostics.length > 0) {
      const details = this.contentEl.createEl("details", {
        cls: "dtcu-diagnostics",
      });
      details.createEl("summary", {
        text: `${this.projection.diagnostics.length} projection diagnostics`,
      });
      const list = details.createEl("ul");
      for (const diagnostic of this.projection.diagnostics) {
        list.createEl("li", {
          text: diagnostic.expression === undefined
            ? diagnostic.message
            : `${diagnostic.expression}: ${diagnostic.message}`,
        });
      }
    }

    const preview = this.contentEl.createEl("textarea", {
      cls: "dtcu-projection-preview",
      attr: {
        "aria-label": "Projected template defaults",
        readonly: "readonly",
        spellcheck: "false",
      },
    });
    preview.value = this.projection.previewMarkdown;

    const actions = this.contentEl.createDiv({ cls: "dtcu-modal-actions" });
    new ButtonComponent(actions)
      .setButtonText("Copy projection")
      .setCta()
      .onClick(() => {
        void navigator.clipboard
          .writeText(this.projection.previewMarkdown)
          .then(() => new Notice("Projected defaults copied."))
          .catch(() => new Notice("Could not copy the projected defaults."));
      });
    new ButtonComponent(actions)
      .setButtonText("Close")
      .onClick(() => this.close());
  }

  public override onClose(): void {
    this.contentEl.empty();
  }
}

export class SyncReportModal extends Modal {
  public constructor(
    app: App,
    private readonly report: SyncReport,
    private readonly showDetailedChanges: boolean,
    private readonly maximumChangedNotes: number,
  ) {
    super(app);
  }

  public override onOpen(): void {
    this.setTitle("Template child update report");
    this.modalEl.addClass("dtcu-report-modal");
    this.contentEl.empty();
    this.contentEl.createEl("p", { text: statusSummary(this.report) });

    if (this.report.templates.length === 0) {
      this.contentEl.createEl("p", {
        text: "No designated note templates were found.",
      });
    }

    if (this.showDetailedChanges) {
      this.renderChangedNotes();
    }

    for (const template of this.report.templates) {
      const details = this.contentEl.createEl("details", {
        cls: `dtcu-report-template is-${template.status}`,
      });
      details.createEl("summary", {
        text: `${template.templatePath} — ${template.status}`,
      });
      if (template.message !== undefined) {
        details.createEl("p", { text: template.message });
      }
      if (template.diagnostics.length > 0) {
        const diagnostics = details.createEl("ul");
        for (const diagnostic of template.diagnostics) {
          diagnostics.createEl("li", {
            text: diagnostic.expression === undefined
              ? diagnostic.message
              : `${diagnostic.expression}: ${diagnostic.message}`,
          });
        }
      }
      const updated = template.children.filter(
        (child) => child.status === "updated",
      ).length;
      const unchanged = template.children.filter(
        (child) => child.status === "unchanged",
      ).length;
      const failed = template.children.filter(
        (child) => child.status === "error",
      );
      if (template.children.length > 0) {
        details.createEl("p", {
          text: `${updated} updated, ${unchanged} unchanged, and ${failed.length} failed.`,
        });
      }
      for (const child of failed) {
        const childDetails = details.createEl("details", {
          cls: "dtcu-report-child is-error",
        });
        childDetails.createEl("summary", {
          text: `${child.path} — error`,
        });
        if (child.message !== undefined) {
          childDetails.createEl("p", { text: child.message });
        }
        for (const conflict of child.conflicts) {
          childDetails.createDiv({
            cls: "dtcu-conflict",
            text: `${conflict.path}: ${conflict.message}`,
          });
        }
      }
    }

    const actions = this.contentEl.createDiv({ cls: "dtcu-modal-actions" });
    new ButtonComponent(actions)
      .setButtonText("Close")
      .setCta()
      .onClick(() => this.close());
  }

  public override onClose(): void {
    this.contentEl.empty();
  }

  private renderChangedNotes(): void {
    const changedNotes: Array<{
      child: ChildUpdateResult;
      templatePath: string;
    }> = [];
    for (const template of this.report.templates) {
      for (const child of template.children) {
        if (child.status === "updated") {
          changedNotes.push({ child, templatePath: template.templatePath });
        }
      }
    }
    if (changedNotes.length === 0) {
      return;
    }

    this.contentEl.createEl("h3", { text: "Changed notes" });
    const displayed = changedNotes.slice(0, this.maximumChangedNotes);
    if (displayed.length < changedNotes.length) {
      this.contentEl.createEl("p", {
        cls: "dtcu-report-limit-notice",
        text: `Showing ${displayed.length} of ${changedNotes.length} changed notes. Increase “Maximum amount of changed notes to display in this report” in the plugin settings to show more.`,
      });
    }

    for (const { child, templatePath } of displayed) {
      const details = this.contentEl.createEl("details", {
        cls: "dtcu-report-child is-updated",
      });
      details.createEl("summary", { text: child.path });
      details.createEl("p", {
        cls: "dtcu-report-template-path",
        text: `Template: ${templatePath}`,
      });
      if (child.changes.length === 0) {
        details.createEl("p", {
          text: "The note changed, but no semantic field-level difference was available to summarize.",
        });
      } else {
        const changes = details.createEl("ul", {
          cls: "dtcu-change-list",
        });
        for (const change of child.changes) {
          const item = changes.createEl("li", {
            cls: `dtcu-change is-${change.category}`,
          });
          item.createSpan({
            cls: "dtcu-change-category",
            text:
              change.category === "body"
                ? "Body text"
                : change.category[0]?.toLocaleUpperCase() +
                  change.category.slice(1),
          });
          item.createSpan({ text: change.description });
        }
      }
      for (const conflict of child.conflicts) {
        details.createDiv({
          cls: "dtcu-conflict",
          text: `${conflict.path}: ${conflict.message}`,
        });
      }
    }
  }
}

export function summarizeReport(report: SyncReport): string {
  return statusSummary(report);
}
