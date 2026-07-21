# Context builder

`@lattice/context-builder` constructs bounded, deterministic structural context from an existing scan, parse analysis, resolved analysis, and repository knowledge model. It never scans, parses, resolves modules, reads workspace configuration, or invokes semantic/LLM services.

## Public API

`buildContextPackage(input): Promise<ContextPackage>` accepts the four pipeline models, one file/symbol/folder/project target, optional selection limits, and an injected `ContextSourceProvider`. Targets use exactly one lookup strategy; a symbol name may be narrowed by file. Missing, conflicting, and ambiguous targets use typed errors.

Defaults are source enabled, 20 files, 80 symbols, 120 relations, 20 excerpts, 4,000 characters per excerpt, 30,000 total source characters, dependency/dependent/folder depth 1, and external dependencies and diagnostics enabled. Safety ceilings are respectively 500, 5,000, 10,000, 500, 100,000, 1,000,000, depth 5/5/10. Counts are positive integers; depths may be zero.

Selection uses integer priority classes and stable path/location/ID tie breakers. A file target ranks its public declarations, remaining declarations, imported bound symbols, dependency public symbols, and other optional symbols. A symbol target gives the target only `target`, adds neighboring declarations as `same-file-symbol`, and selects incoming-binding files without claiming their unrelated declarations own the binding.

Project targets include the target, directly required projects, directly dependent projects, and connecting dependency records. Files rank by project-public symbols, cross-project participation, parsed production source, parsed tests, then configuration/documentation or unsupported files. Dependency counts, path, and ID break ties. Test and configuration classification uses only stable filename/path and scanner-language metadata.

Folder targets consider descendant files independently of `folderDepth`. Parsed public/source files rank before ordinary parsed source and metadata. `folderDepth` controls displayed descendant folders by exact edge distance: target 0, child 1, grandchild 2. Deeper folders remain when mandatory to contain a selected file. Reasons use a fixed public order and are deduplicated. Mandatory targets, a symbol's file, and hierarchy ancestors cannot be dropped; an insufficient limit raises `CONTEXT_LIMIT_TOO_SMALL`.

Source is read only through `ContextSourceProvider`. Returned file ID, normalized relative path, declared hash, recomputed SHA-256, and a 2,000,000-character safety ceiling are verified. A mandatory file/symbol source failure is fatal; optional source failures become omissions. Binary source is not included.

Excerpt requests are derived after file and symbol selection. File contexts prioritize the target header, selected target public symbols, selected target private symbols, bound symbols, dependency public symbols, and optional headers. Symbol-backed excerpts reference only selected symbols; headers may have no symbol IDs. Public positions use one-based inclusive lines and zero-based character offsets, with an exclusive ending character. Parser locations are one-based lines with zero-based UTF-8 byte columns; the builder expands symbol ranges by two lines and emits whole-line excerpts. Header ranges use at most the first 80 lines. Ranges in one file that overlap or are within three lines merge. Text exceeding a limit keeps 65% from the beginning and 35% from the end around a fixed marker without splitting UTF-16 surrogate pairs.

Relations are emitted only when both endpoints are selected. Before truncation they rank target relationships, target dependencies, target bindings, effective exports, project dependencies, and finally optional containment. The hierarchy section remains authoritative when containment is omitted. File dependency metrics always describe complete repository knowledge rather than the bounded relationship subset.

Limit and source exclusions are aggregated in stable omission records. `SOURCE_DISABLED` counts all selected files when package-wide source access is disabled; it does not represent excerpt candidates or read failures. The package uses independent schema version `"1"`; its SHA-256 ID covers the repository node, resolved target, normalized options, excerpt mode, and selected scanner hashes when source is enabled. It excludes timestamps, durations, absolute file paths, model token estimates, persistence, embeddings, semantic ranking, summaries, call/type/runtime graphs, Git history, and MCP transport.
