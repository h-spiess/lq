# Changelog

## 0.8.7

- Fixed default paragraph alignment in Preview so ordinary paragraphs use LyX's justified default.
- Honor the document's screen-justification setting and preserve explicit left, center, right, and justified paragraph choices.
- Preserve alignment for custom layouts, copied styles, and right-to-left paragraphs.

## 0.8.6

- Added LyX Preview to VS Code's editor choices for `.lyx` files, alongside Text Editor.
- Added **Open in LyX** to the raw editor and Preview, saving the selected document before opening it in LyX.
- Added a **Changes** dropdown for Original, Tracked, and Clean views.
- Improved split previews: each panel keeps its change view, and saving refreshes all panels for the document.
- Updated toolbar icons and editor-picker labels in LyX Preview 0.1.8.

## 0.8.5 - 2026-09-30

- Bug fixes and maintenance.

## 0.8.4 - 2026-09-06

- Added basic table creation with `lq insert --table` and table inspection and editing with `lq table`.
- Fill tables and add or remove rows and columns while preserving their appearance in LyX, with tracked changes and undo support.
- Improved Preview's resemblance to the LyX window.

## 0.8.3 - 2026-09-04

- Improved Preview's tables, spacing marks, wrap floats, graphics, and inset chips to match the LyX window more closely.

## 0.8.2 - 2026-09-03

- Improved built-in help.

## 0.8.1 - 2026-09-02

- Made Preview faster, especially for long documents containing many icons or converted figures.
- Read icons as vector graphics and cache converted figures so text-only refreshes avoid repeated image conversion.

## 0.8.0 - 2026-09-02

- Rewrote lq in Rust for faster execution and a smaller binary.
- Tightened command handling, reduced silently ignored input, and improved errors and help accuracy.

## 0.7.1 - 2026-08-30

- Added automatic binary verification, download, and updates through LyX Preview's `lyx-preview.lqPath` setting.
- Published binaries for Windows, macOS, and Linux on both x86_64 and ARM64.
- Improved math font glyphs, styled text in formulas, brace delimiters, and matrix rendering.
- Added appendix boundaries and numbering, with nested subfigure and subtable numbering and outline entries.
- Improved expanded inset sizing, full-width boxes, and figure notes containing inline formulas.

## 0.7.0 - 2026-08-27

- Introduced `lq preview` and the companion LyX Preview extension for VS Code.
- Fixed adjacent tracked-change boundaries between authors and improved author-specific replay undo.
- Corrected `split-after` markup and mutations involving empty content, formatting, and inset boundaries.
- Fixed Windows document switching through LyXServer and improved path handling and ImageMagick discovery across platforms.

## 0.6.0 - 2026-08-13

- Rebuilt the help catalog, updated the `use-lq` skill, and clarified diagnostics. Added `--rich=auto|always|never` for help rendering.
- Renamed `:nth-child` to `:nth-match`; the previous name is rejected.
- Fixed `:until()` boundaries, improved query speed, and corrected `:not(:contains(...))` matching. Invalid selector formulas now fail clearly.
- Preserved other authors' deleted text during `set --find` and prevented tracked-change markers from being written outside paragraph text.
- Allowed `lq bib` to read a `.bib` file directly and fixed bibliography paths containing dots.
- Restored insertion schema validation and improved reporting for `split-after` across multiple targets.

## 0.5.8 - 2026-08-06

- Changed undo selection: `lq undo <file>` restores the last mutation snapshot; adding a selector replays the current author's tracked changes, with an optional substring filter.
- Explained replay no-ops and reported how many matched nodes were actually reverted.
- Removed suggestions to change author configuration from author-mismatch warnings.
- Made tracked replacement preserve other authors' deleted text and handle existing insertions according to LyX's overwrite behavior.

## 0.5.7 - 2026-08-05

- Made `lq init` create project-local `.lq` state by default; added `--global` for profile-wide state.
- Kept configuration, cache, and undo snapshots within the selected scope and reported that scope in `init` responses.
- Fixed tracked `set --find` so immediately following insets survive accepting the edit.
- Excluded private Note and Comment prose from ordinary content matching; added `:note` and explicit inset paths for intentional access.
- Improved explanations when requested text exists only in private notes.

## 0.5.6 - 2026-08-04

- Added `:change(current|inserted|deleted)` and `:property(key[=value])` selectors.
- Supported edits spanning tracked-change boundaries and nested content, with state predicates to narrow the target.
- Made direct text mutations honor tracking and preserve reviewable deleted and inserted content.
- Required a snapshot for selector-only undo; replay undo required a substring in this release.
- Fixed Windows and Git Bash snapshot paths and improved selector, cache-setting, and mutation guidance.

## 0.5.5 - 2026-08-02

- Added snapshot undo for the last tracked or plain mutation, including deleted nodes, and author-specific replay undo with a substring.
- Matched phrases across text-node boundaries for `--find`, `split-after`, and `:contains`.
- Added tracked-change annotations to `read`, `dump`, and plain-text output.
- Improved editing within existing tracked changes and preserved formatting when rejecting replacements.
- Made `--toc --depth` follow absolute LyX heading levels and improved mutation errors and refresh confirmations.

## 0.5.4 - 2026-07-30

- Added skill guidance for creating, importing, and exporting documents through the LyX application.
- Other fixes and improvements.

## 0.5.3 - 2026-07-01

- Corrected heading hierarchies for removed styles and negative heading levels; improved fallback headings and class-specific inset catalogs.
- Retained core schema information when layout files are unavailable.
- Allowed undo independently of the tracking setting and limited replay to the current author's changes.
- Moved schema layout-directory configuration to `lq init` and improved help.

## 0.5.2 - 2026-06-30

- Added section-scoped queries with the `~` sibling combinator and `:until()`.
- Added `dump --toc` using document-class heading levels.
- Allowed `read --count` and `--text-only` together.
- Added configurable author names through `lq init --author-name`.
- Improved substring-edit feedback, warnings for pending changes, and handling of deleted text during `split-after`.

## 0.5.0 - 2026-06-26

- Added undo for tracked changes and mutation summaries in JSON responses.
- Enabled tracked mutations by default and displayed pending changes in plain-text output.
- Changed count output to a breakdown by node type.
- Improved insertion-point matching around deleted text and warned before re-editing pending changes.

## 0.4.0 - 2026-06-25

- Added selector prefixes and inset markers to plain-text output, preserving structure and preventing text from joining across omitted insets.
- Added a file-content cache to avoid parsing unchanged documents repeatedly.
- Fixed commas inside `:contains()` and required a node tag before pseudo-classes.

## 0.3.4 - 2026-06-24

- Fixed document tracking headers so LyX retains pending changes when opening edited files.
- Added `set --find` for substring replacement while preserving surrounding text and insets.
- Added `read --text-only` and `:adjacent()` for matching nodes by their preceding sibling.

## 0.3.3 - 2026-05-25

- Preserved insertion order for multiple blocks supplied through `--raw-file`.
- Added `:not()`, label and footnote insertion helpers, and the `split-after` insertion position.
- Added depth-limited document dumps.
- Made `set` preserve nested insets and properties by default; `--replace-all` retained full replacement.

## 0.3.2 - 2026-05-24

- Added citation and cross-reference insertion helpers: `--cite`, `--cite-cmd`, `--ref`, and `--ref-cmd`.

## 0.3.1 - 2026-05-23

- Rejected layout insertions that would create invalid nested paragraphs.
- Made unknown inset handling consistently warning-only.
- Added warnings for mutations matching multiple nodes and `read --count` for counting matches.
- Removed inline `--raw` insertion in favor of `--raw-file` and reduced redundant tracking markers during replacement.

## 0.3.0 - 2026-05-22

- Added automatic LyX refresh with `none`, `reload`, and `save-reload` modes.
- Added counts to read responses and bibliography filtering with `bib --search`.
- Moved tracking and layout validation settings into configuration.
- Fixed multi-block raw insertion and reduced repeated tracking markers.

## 0.2.0 - 2026-05-20

- Improved batch insertion speed and made invalid targets fail individually.
- Expanded the inset catalog and warned about unknown inset types.
- Fixed layout-directory validation and invalid insertion contexts inside nested content.
- Added `--raw-file` and tracked deletion support.

## 0.1.0 - 2026-05-19

- First release in the published GitHub history; no release notes were provided.
