# Changelog

## 0.4.1

- Migrated the settings tab to Obsidian's declarative `getSettingDefinitions()` API.
- Made every setting searchable by name, description, and relevant aliases in Obsidian's global settings search.
- Preserved the custom template-folder manager and synchronized numeric-input/slider report-limit control as indexed declarative render definitions.
- Replaced the automatic-update debounce text field with a validated numerical input accepting whole milliseconds from 250 through 60000.
- Raised `minAppVersion` to Obsidian 1.13.0, the version that introduced declarative searchable plugin settings.
- Added GitHub build-provenance attestations for `main.js`, `manifest.json`, and `styles.css` before release publication.
- Added regression coverage for the complete searchable-setting inventory and control metadata.

## 0.4.0

- Renamed the plugin to **Dynamic Template Children Updater**.
- Changed the manifest and package ID to `dynamic-template-children-updater`; the intended vault folder now uses the same name.
- Added built-in static projection support for `${digitalPageCount}`.
- Represented `digitalPageCount` as a child-specific dynamic scalar rather than an unresolved empty expression.
- Preserved numeric, boolean, string, and null dynamic scalar types during frontmatter synchronization, including when non-default property-value enforcement is enabled.
- Kept legacy 0.3.0 dynamic-slot tokens readable so copied settings and baseline data remain compatible after the ID migration.
- Renamed internal implementation and style identifiers to match the new plugin identity.
- Added regression coverage for projection diagnostics, numeric page-count preservation, enabled and disabled value enforcement, and legacy baselines.
- Confirmed compatibility with Obsidian Desktop 1.13.7, the latest public desktop release when this version was produced.

## 0.3.0

- Fixed duplication of the generated first heading during manual projection enforcement.
- Fixed customized headings being misclassified as child-only additions and duplicated beside their template headings.
- Added structural and dynamic-value-aware heading alignment so subordinate child additions do not destabilize surrounding template sections.
- Added optional collapsed per-note details to the manual **Template child update report**.
- Added semantic property, heading, ordering, and body-text change descriptions for each displayed changed note.
- Added **Maximum amount of changed notes to display in this report**, with synchronized numeric input, slider, and reset controls; the default is 25 and the range is 1–500.
- Bounded detailed-change collection to the configured report maximum while leaving overall counts and errors complete.
- Redesigned **Note template locations** as a collapsible panel with inline fuzzy folder suggestions, a refined add/edit modal, duplicate and invalid-path validation, removal controls, and drag or keyboard reordering.
- Added regression coverage for the reported full-template heading scenarios and semantic change reporting.
- Updated the compatibility declaration for version 0.3.0 to Obsidian 1.13.7.

## 0.2.0

- Replaced the multi-line template-folder field with one row per location, manual path entry, and a searchable folder-selection modal.
- Corrected the template-location guidance to require every Markdown file in each listed folder to be a template.
- Renamed all four non-default merge controls from **Apply … changes** to **Apply … updates**.
- Changed manual synchronization to reapply the current template projection even when the template itself has not changed.
- Made enabled key, value, heading, and body-text update controls enforce their current projected defaults on matched customized child fields.
- Preserved the prior defaults: property-key and heading updates on; property-value and body-text updates off.
- Added automatic migration for the four version 0.1.0 setting keys.
- Added regression coverage for unchanged-template projection enforcement and disabled-toggle preservation.
- Updated the compatibility target to Obsidian 1.13.7 and the development API types to 1.13.1.

## 0.1.0

- Added configurable template-folder discovery and `Note Template Class` links.
- Added automatic and manual child-note synchronization.
- Added persistent three-way baselines for template, child, and new-default merges.
- Added independent default-on key and heading controls.
- Added independent default-off value and body-text overwrite controls.
- Added property rename, hierarchy, order, addition, removal, and child-only-field handling.
- Added ATX heading support through H12, section reordering, and body preservation.
- Added static core Templates and Templater projections with dynamic title/date slots.
- Added a projection preview, diagnostics, conflict reporting, mobile-safe implementation, tests, and release documentation.
