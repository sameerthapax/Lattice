# core-knowledge

`@lattice/core-knowledge` constructs deterministic structural knowledge from an
existing scan, parser analysis, resolved repository analysis, and optional injected
workspace project metadata. It performs no filesystem access, parsing, Nx access,
source inspection, persistence, or inference and does not mutate its inputs.

## Public API

```ts
const knowledge = buildRepositoryKnowledge({
  scan,
  analysis,
  resolution,
  projects: [
    {
      name: 'cli',
      kind: 'application',
      rootRelativePath: 'apps/cli',
      sourceRootRelativePath: 'apps/cli/src',
      entryPoints: [{ relativePath: 'apps/cli/src/main.ts' }],
    },
  ],
});
```

The result contains repository, project, folder, file, and symbol nodes; typed
relations; aggregated project dependencies; and structural summaries. Public
arrays contain plain immutable records, never maps, sets, syntax trees, source
text, or per-file absolute paths.

## Hierarchy and project metadata

Folders are the normalized repository-relative directories required by scanned
files; no fake root or empty folders are created. Root files belong directly to
the repository. Every scanned file becomes a node: parsed files are `parsed`,
parser failures are `failed`, and retained scan-only files are `skipped`.

Projects use injected `WorkspaceProjectDefinition` records only. The longest
matching normalized project root owns a file or folder. Files outside all projects
remain valid and projectless. Duplicate roots, conflicting duplicate names, paths
escaping the repository, source roots outside project roots, and entry points
outside or absent from the scan throw `KnowledgeBuilderInputError` with a stable
reason code.

## Symbols, surfaces, and relationships

Every parser symbol is wrapped in a namespaced knowledge ID. Explicit parser parent
IDs are preserved; nesting is never inferred from ranges. A file public surface is
its effective resolved exports, including direct/default exports and unambiguous
re-exports/export-all results. Default does not flow through export-all. A project's
public surface is the deduplicated originating symbols from configured entry-point
files only; without entry points it is empty.

Relations represent repository/folder containment, project membership, declarations,
effective exports, internal file dependencies, symbol bindings, symbol parents, and
cross-project dependencies. Cross-project records aggregate only resolved file edges
whose endpoints belong to different projects, retain sorted contributing dependency
IDs, and count type-only edges.

## Metrics, identity, and ordering

Metrics are counts only. An orphan is a parsed file with no incoming or outgoing
internal dependency that is not a configured entry point. IDs are SHA-256 hashes
under `knowledge:v1` namespaces using stable identity fields. Projects sort by root
then name; folders/files by path; symbols by path/location/kind/name/ID; relations
and project dependencies use explicit stable comparators. Timestamps and traversal
order do not affect output.

Feature inference, semantic modules, natural-language summaries, call/type/runtime
graphs, persistence, search, context packages, wiki rendering, and MCP queries are
outside this library.
