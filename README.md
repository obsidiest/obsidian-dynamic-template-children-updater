# Dynamic Template Children Updater

Dynamic Template Children Updater keeps existing Obsidian notes synchronized with the templates that define their default frontmatter and Markdown structure. It supports ordinary Markdown templates used by the core **Templates** plugin and statically projects common **Templater** output without executing template code.

Each managed note declares its template through a top-level property whose default name is `Note Template Class`:

```yaml
---
Title: A child note
Note Template Class: "[[Book Note Template]]"
---
```

Templates can carry the same property as a self-link. Every Markdown file inside a configured **Note template location** is treated as a template and is always excluded from child-note updates.

## How synchronization works

The plugin records the current static projection of each designated template as its baseline. After the template projection changes, it performs a three-way merge among:

1. the prior template projection;
2. the child note as it exists now; and
3. the new template projection.

This separates structural changes from value changes. For example, suppose the prior template default was:

```yaml
Publishers:
  -
```

the child contains:

```yaml
Publishers:
  - Myself
```

and the template changes to:

```yaml
Current Publishers: God
```

With property-key changes enabled and non-default property-value overwrites disabled, the child becomes:

```yaml
Current Publishers:
  - Myself
```

Enabling non-default property-value overwrites instead produces `Current Publishers: God`.

The manual command also performs a current-projection enforcement pass when the template has not changed. This lets a later manual update restore a child customization to the template's current property key, property value, heading, or body text whenever that category's **Apply … updates** toggle is enabled. For example, with heading updates enabled, changing `## Official Synopses` to `## My Synopses` in a child and then running the manual command restores `## Official Synopses`.

The merge also follows matched properties across parent-hierarchy changes, recognizes generated/dynamic headings, applies template ordering, adds new fields and headings, and removes fields or sections that still equal their prior defaults. Child-only fields and headings are retained. A template-removed field containing non-default data is retained and reported as a conflict while non-default property-value overwrites remain disabled.

`Note Template Class` is preserved from each child note and placed last whenever the plugin rewrites that note's frontmatter.

## Settings

| Setting | Default | Effect |
| --- | --- | --- |
| Note template class property | `Note Template Class` | Selects the top-level property containing the template link. |
| Note template locations | `Templates` | A collapsible list of vault-relative folders. Every row has inline fuzzy suggestions, a searchable folder editor, removal, and drag/keyboard reordering. Use only if every Markdown file in a listed folder is a template. |
| Automatically update note template children | Off | Applies changes after a configurable debounce. When off, the baseline remains unchanged until the manual command runs. |
| Apply given default property key updates… | On | Reapplies current projected key names, hierarchy, and order to matched fields, including customized child keys. |
| Apply given default property value updates… | Off | Reapplies current projected values to matched fields, including non-default child values. |
| Apply given default heading updates… | On | Reapplies current projected heading names, levels, hierarchy, and order to matched child headings. |
| Apply given default body text updates… | Off | Reapplies current projected section text to matched sections, including non-default child text. |
| Show detailed changes in manual update report | On | Adds one collapsed section per changed child note with its property, heading, and body-text updates. |
| Maximum amount of changed notes to display in this report | `25` | Caps detailed changed-note sections. Includes a numeric input, slider (`1`–`500`), and reset button; summaries and errors remain complete. |

Changing an update toggle does not itself rewrite notes. Run the manual command to enforce the selected categories immediately, or let a later template edit invoke them when automatic updates are enabled. No command has a default hotkey; assign one in **Settings → Hotkeys** if desired.

## Commands

- **Manually update note template children** reapplies the current projection to the active template's children even if the template has not changed. When invoked from a child note, it updates that child's template class. Otherwise, it checks every designated template. Its report can show a collapsed, semantic change list for each updated note.
- **Preview projected defaults for active note template** shows exactly what the static projector considers the template's defaults and lists unresolved expressions.

## Core Templates support

Ordinary Markdown and frontmatter are used directly. `{{title}}`, `{{date}}`, and `{{time}}` are represented internally as dynamic slots and appear blank in the projection preview. Existing generated values continue to match those slots, so unrelated template changes do not erase them.

## Templater support

Templater code is never executed during projection. This prevents synchronization from opening prompts, renaming files, reading external files, or producing other template side effects.

The static projector supports:

- literal Markdown outside Templater blocks;
- string and template-literal assignments through `tR = …` and `tR += …`;
- `${noteTitle}` and common `tp.file.title` forms as dynamic title slots;
- `tp.file.cursor()` as empty output;
- common `tp.date.now(…)` expressions as dynamic date slots;
- `${digitalPageCount}` as a typed dynamic scalar that retains each child's generated number or blank value;
- `coverImageBlock` → `Cover Image:`;
- `sourceFileUrlsBlock` → `Source File URLs:`;
- `parsed.edited` → `false`;
- `listBlock(value)` and `listBlock(value, indentation)` → an empty list item with the requested indentation;
- ternaries whose false branch is an empty string → empty output; and
- exact user-defined expression replacements under **Templater expression defaults**.

The advanced replacement setting is a JSON object. Keys omit the surrounding `${…}` or `<%…%>` delimiters:

```json
{
  "custom.defaultValue": "Projected default",
  "custom.optionalBlock": "Heading:\n  - "
}
```

Dynamic scalar slots appear blank in the projection preview because their values are produced separately for each child. During synchronization, the merger captures and restores each child's value without coercing its YAML type; for example, a numeric `Digital Page Count` remains numeric even when non-default property-value updates are enabled.

Arbitrary JavaScript control flow cannot always be reduced to one safe static output. Conditional or dynamically assembled `tR` values may therefore need an exact replacement or a simpler literal output block. Always inspect **Preview projected defaults** after materially changing template-generation logic. An unresolved expression is projected as empty and included in the update report.

## Baselines and safe use

- On first automatic or startup discovery, the plugin records a baseline and does not rewrite existing children. The explicit manual command can apply the current projection immediately, including during first-time initialization.
- Automatic updates are disabled by default. Review the projection, then run the manual command before enabling automatic updates.
- If any child update fails, the old baseline is retained so the same template change can be retried.
- Ambiguous property or heading renames are matched conservatively using names, generated-value recognition, structural position, heading ancestry, type, and order. Child-added subordinate headings do not shift or duplicate their template ancestors. For the clearest result, preview and apply unusually large schema rewrites in logical stages.
- Background frontmatter changes use Obsidian's `FileManager.processFrontMatter`, which may normalize YAML formatting. YAML comments and hand-selected scalar styles should not be treated as persistent metadata.
- The quoted internal-link form (`"[[Template]]"`) is recommended because it is unambiguous YAML. The class resolver also accepts link-like arrays and plain link paths returned by Obsidian's metadata cache.
- Keep Obsidian's File Recovery enabled and make a vault backup before the first large synchronization.

## Compatibility

Version 0.4.0 targets **Obsidian 1.13.7**, the latest public desktop release when this version was produced, while retaining `minAppVersion: 1.8.7`. The plugin is not marked desktop-only and does not execute Node.js or Templater JavaScript at runtime.

## Installation

### Manual

1. Download the release assets `main.js`, `manifest.json`, and `styles.css`.
2. Create `<vault>/.obsidian/plugins/dynamic-template-children-updater/`.
3. Place the three files in that folder.
4. Reload Obsidian and enable **Dynamic Template Children Updater** under **Community plugins**.

### Upgrading from 0.3.0

Version 0.4.0 changes the manifest ID from `dynamically-updating-templates` to `dynamic-template-children-updater`, so Obsidian treats it as a newly identified plugin.

1. Disable **Dynamically Updating Templates**.
2. Install version 0.4.0 in `<vault>/.obsidian/plugins/dynamic-template-children-updater/`.
3. To retain settings and recorded baselines, copy `data.json` from the old plugin folder into the new folder before enabling the renamed plugin. Version 0.4.0 recognizes the legacy dynamic-slot format stored by 0.3.0.
4. Enable **Dynamic Template Children Updater**, verify its settings and projection preview, and run a manual update.
5. After confirming the migration, remove the old `dynamically-updating-templates` folder. Do not enable both IDs simultaneously.

### Build from source

```bash
npm install
npm test
npm run lint
npm run build
```

The production bundle is written to `main.js`. The repository keeps that verified runtime at its root for direct deployment, and matching GitHub releases attach `main.js`, `manifest.json`, and `styles.css`.

## Privacy and security disclosures

- No telemetry, analytics, advertisements, account requirement, or network access.
- No access to files outside the active Obsidian vault.
- No Templater JavaScript execution.
- All plugin data is stored through Obsidian's plugin data API.
- Runtime dependency: [`yaml`](https://www.npmjs.com/package/yaml), bundled into `main.js` for safe YAML parsing and validation.

## Development and release

The repository includes a lock file and uses the official `eslint-plugin-obsidianmd` rules. Before a Community directory submission, create a GitHub release whose tag exactly matches `manifest.json`'s version and attach `main.js`, `manifest.json`, and `styles.css`. Submit only the initial version through Obsidian's plugin-submission workflow; subsequent versions are distributed through matching GitHub releases.

## Attribution

- Concept, requirements, product direction, and testing: [obsidiest](https://github.com/obsidiest)
- Implementation generated with **GPT-5.6 Sol (Max), OpenAI**, under obsidiest's direction.

## License

[MIT](LICENSE)
