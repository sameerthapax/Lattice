# core-analyzer

`@lattice/core-analyzer` is Lattice's deterministic cross-file resolution stage.
It consumes an existing `RepositoryScan` and syntax-only `RepositoryAnalysis`; it
does not read files, traverse the repository, parse source, or mutate either input.

## Public API

```ts
const resolved = resolveRepositoryAnalysis({
  scan,
  analysis,
  workspaceAliases: [
    {
      alias: '@lattice/core-parser',
      targetRelativePaths: ['libs/core/parser/src/index.ts'],
    },
  ],
});
```

The synchronous result contains sorted modules, internal dependencies, external
dependencies, symbol bindings, structured unresolved dependencies, and cycles.
Invalid cross-input invariants or malformed aliases throw `ResolverInputError`;
ordinary missing modules, exports, conflicts, and cycles do not.

## Resolution rules

Relative specifiers are normalized with POSIX separators and may not escape the
repository. Candidates are checked in this fixed order: exact path, `.ts`, `.tsx`,
`.js`, `.jsx`, then `index.ts`, `index.tsx`, `index.js`, `index.jsx`. Explicit `.js`
checks `.js`, `.jsx`, `.ts`, `.tsx`; explicit `.jsx` checks `.jsx`, `.tsx`. The first
parsed candidate wins. A scanned but unparsed candidate reports
`TARGET_NOT_PARSED`. `.mjs` and `.cjs` remain unsupported by the parser scope.

Workspace aliases are injected as an alias plus ordered repository-relative entry
paths. Subpaths resolve beside an alias entry point. Unmatched packages are
external, except unmatched names in a configured workspace namespace, which report
`WORKSPACE_ALIAS_NOT_FOUND`. External packages are recorded and never inspected.

## Relationships

Internal dependency kinds are `import`, `side-effect-import`, `re-export`, and
`export-all`. Edges are deduplicated by source file, target file, kind, source
specifier, and type-only state. Multiple specifiers from one import therefore share
one edge. Named and default imports create bindings to an effective export and its
originating symbol; namespace and side-effect imports resolve only to a module.

Named re-exports follow chains to the originating symbol. `export *` exposes named
exports but never default. Explicit local and named re-exports take precedence over
export-all. If multiple export-all sources expose the same otherwise-unclaimed name,
the name is `AMBIGUOUS_EXPORT`; no target is chosen. Traversal is cycle-protected.

Cycles are nonfatal and canonicalized by comparing rotations in both directions,
then sorted by canonical relative-path sequence. IDs are SHA-256 hashes over stable
structural fields. Moving files or declarations can change identity. Every public
collection is explicitly ordered; repeated identical inputs produce deeply equal
results.

Unresolved reasons are `MODULE_NOT_FOUND`, `PATH_ESCAPES_REPOSITORY`,
`TARGET_NOT_PARSED`, `EXPORT_NOT_FOUND`, `AMBIGUOUS_EXPORT`,
`UNSUPPORTED_SPECIFIER`, and `WORKSPACE_ALIAS_NOT_FOUND`.

## Limitations

There is no CommonJS or dynamic-import resolution, package export-condition
interpretation, Node modules inspection, TypeScript compiler semantic resolution,
call graph, type graph, persistence, or AI analysis.
