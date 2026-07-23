# Lattice architecture

## 1. System purpose

Lattice is a local-first knowledge layer for source-code repositories. Its planned outputs are a living wiki, structural dependency map, knowledge graph, and task-specific context for people and coding agents. Deterministic repository scanning, JavaScript/TypeScript source parsing, cross-file module resolution, and structural knowledge construction are implemented; generated natural-language knowledge remains planned.

## 2. Current workspace structure

The integrated Nx workspace uses npm and strict TypeScript. Projects live in `apps/` and `libs/`, with ESLint enforcing tagged dependency boundaries.

```text
apps/
  web/                 Next.js App Router application
  api/                 Fastify Node application
  cli/                 Node CLI entry point
  mcp-server/          Node MCP-server entry point
libs/
  core/                parser, indexer, analyzer, knowledge, graph
  data-access/         database, git, filesystem
  features/            wiki, search, context-builder
  integrations/        llm, mcp
  shared/              types, utils, config
```

## 3. Application responsibilities

- **web:** Loads one server-configured, validated repository-graph artifact through
  `GET /api/graph` and renders it in a client-only Cytoscape explorer. It owns visual
  filtering, layout, selection details, colors, and renderer adaptation, but performs
  no repository analysis and accepts no browser-supplied filesystem path.
- **api:** Owns local HTTP transport and future indexing orchestration and knowledge queries. It currently exposes only `GET /health`; server construction is separate from network binding.
- **cli:** Owns the command-line transport. It implements `index`, `analyze`,
  `context`, and `graph`. The graph command composes all deterministic stages, creates
  a versioned graph artifact, and atomically writes it under the analyzed repository
  by default. Parsing and graph facts remain in their core libraries.
- **mcp-server:** Owns the future Model Context Protocol transport for coding agents. It currently prints `Lattice MCP Server` and implements no MCP behavior.

Applications are entry points and composition roots. Reusable logic belongs in libraries.

## 4. Library responsibilities

### Core

- **parser:** Consumes repository scans, verifies scanned content hashes through the injected filesystem boundary, parses TypeScript, TSX, JavaScript, and JSX with Tree-sitter, and produces the language-independent repository-analysis model. It owns deterministic symbol/import/export extraction, stable structural IDs, syntax diagnostics, and per-file failure isolation. Tree-sitter types remain private to this boundary.
- **indexer:** Validates repository roots and deterministically describes source files. It owns ignore policy, binary and size filtering, extension-based language detection, stable path IDs, scan models, and repository-scanning domain errors. Parsing is downstream; incremental persistence is not implemented.
- **analyzer:** Consumes scan and parser metadata in memory and deterministically resolves static ES-module targets, dependency edges, effective exports, symbol bindings, external references, unresolved relationships, and cycles. It performs no parsing or filesystem traversal.
- **knowledge:** Builds deterministic repository/project/folder/file/symbol nodes, typed relations, public surfaces, project dependencies, and structural metrics from prior-stage results and injected project metadata. It performs no I/O or inference.
- **graph:** Validates and indexes canonical repository-knowledge nodes and relations,
  provides deterministic incoming/outgoing/neighbor queries, and creates bounded,
  transport-neutral target-neighborhood projections. It performs no repository
  analysis, I/O, persistence, inference, ranking, layout, or rendering.

### Data access

- **database:** Persistence abstraction.
- **git:** Repository and commit operations.
- **filesystem:** Provides the injected filesystem boundary used by the indexer: canonical paths, metadata, deterministic traversal, reads, and SHA-256 operations. It wraps raw Node filesystem failures before they cross the adapter boundary.

### Features

- **wiki:** Generated and human-maintained repository knowledge.
- **search:** Structural, textual, and future semantic retrieval.
- **context-builder:** Task-specific context packages for coding agents.

### Integrations

- **llm:** Provider-independent model interfaces.
- **mcp:** MCP tools, resources, and transport integration.

### Shared

- **types:** Truly cross-cutting types.
- **utils:** Small stateless utilities.
- **config:** Validated application configuration.

Shared projects must stay domain-neutral. All library public APIs flow through their `src/index.ts` entry points.

## 5. Dependency-direction rules

Nx tags and `@nx/enforce-module-boundaries` define the allowed directions:

| Source       | May depend on                                     |
| ------------ | ------------------------------------------------- |
| Applications | Core, data access, features, integrations, shared |
| Features     | Core, data access, integrations, shared           |
| Core         | Core, shared                                      |
| Data access  | Shared                                            |
| Integrations | Core, shared                                      |
| Shared       | Shared                                            |

No library may import an application. Cross-project imports use `@lattice/*` aliases and public entry points. Circular dependencies are prohibited. A project should not add a dependency merely to demonstrate that it is allowed.

The indexer and parser imports of the public `@lattice/filesystem` abstraction are
the narrow core-to-data-access exception. ESLint allows that exact public alias
without opening core libraries to other data-access projects or internal filesystem
modules. Both libraries use dependency injection and public entry points.

## 6. Current runtime topology

```text
User
├── Web application
├── CLI
└── Coding agent
      │
      ├── API
      └── MCP server
             │
             └── Shared Lattice libraries
```

This diagram shows the intended entry-point relationships, not a set of running
distributed services. All components are local processes in one monorepo. The CLI
invokes the repository scanner for `lattice index` and composes the full deterministic
pipeline for `lattice analyze` and `lattice graph`; the MCP entry point still only
prints a startup message, the web application visualizes configured graph artifacts,
and the API application only reports health.

## 7. Current data flow

```text
Repository
    ↓
Filesystem Scanner
    ↓
Repository Scan
    ↓
Tree-sitter Parser
    ↓
Repository Analysis
    ↓
Module Resolver
    ↓
Resolved Repository Analysis
    ↓
Knowledge Builder
    ↓
Repository Knowledge Model
    ↓
Validated Repository Graph Index
    ↓
Graph Projections, Wiki, Context Builder, Search, MCP
```

`RepositoryKnowledge` is already the canonical directed property graph: its node
arrays and typed relation array own structural facts, stable identities, provenance,
and metrics. `core/graph` does not copy or rediscover those facts. It retains the
knowledge object, indexes its existing node and relation objects, validates duplicate
IDs, missing endpoints, runtime kinds, and endpoint-kind compatibility, and provides
deterministically ordered queries.

Bounded target-neighborhood projection schema `"1"` contains presentation-safe
nodes, edges, roots, and limit omissions. It excludes source, hashes, absolute root
paths, time data, layout coordinates, colors, and UI-library objects. This supports
truthful hierarchy, project/file dependency, public-export, declaration/binding,
explicit nesting, and target-neighborhood views. Import dependency must not be
presented as runtime control flow; call graphs, control/data-flow analysis, runtime
traces, framework routes, and event producer/consumer evidence remain future inputs.

The CLI calls the core indexer, which uses the injected filesystem adapter. The
adapter walks entries and reads file bytes; the indexer applies ignore and file
eligibility policy and returns a scan sorted by repository-relative path. A scan
contains no parsed code or persisted state and does not modify its repository.

The parser consumes only scan records rather than traversing the repository again.
For supported files it reads UTF-8 bytes through the same injected filesystem
boundary, compares SHA-256 content hashes with the scan, and parses a consistent
snapshot. Unsupported languages are skipped. Each parsed file contains ordered
symbols, static imports, exports, and diagnostics; raw syntax trees and source text
do not cross the library boundary. Lines are one-based and columns are zero-based
UTF-8 byte offsets.

Symbol identity hashes the file ID, symbol kind, qualified name, and declaration
start position. This is stable for repeated unchanged analyses; moving a declaration
may change its ID. All repository-derived collections are explicitly sorted.
Recoverable syntax errors produce diagnostics without discarding other extracted
structure. Read, hash-consistency, or unusable-parse failures affect only their file.
The analyzer resolves only files present in the scan and parsed analysis. Relative
candidates use a fixed exact/extension/index order, including documented `.js` to
TypeScript and `.jsx` to TSX source mappings. Root TypeScript path aliases are read
by the CLI composition boundary and injected; the analyzer performs no I/O.
Unmatched packages are external and are never inspected.

One internal edge is retained per source file, target file, dependency kind,
specifier, and type-only state. Named/default imports and named re-exports bind to
effective exports and originating symbols. Export chains are cycle-protected;
`export *` excludes default, explicit exports take precedence, and duplicate
export-all names are ambiguous rather than arbitrarily selected. Dependency cycles
are canonicalized and nonfatal. Missing modules/exports and unsupported specifiers
are stable reason-coded data. IDs hash stable structural inputs with SHA-256 and all
public collections are explicitly sorted. Paths or declarations moving can change
identity. Call graphs and type semantics remain deferred because they require
semantic analysis beyond deterministic syntax and module relationships.

The knowledge builder is a separate pure stage above resolution. It creates only
folders required by scanned files and creates a file node for every retained scan
record, including unsupported and failed files. Parser symbols retain explicit
parent links; no feature or semantic-module hierarchy is inferred. The CLI reads
committed `project.json` metadata and injects plain records. Longest matching project
root precedence assigns membership, while files outside projects remain valid.

Effective resolved exports define file public symbols. Only configured entry points
define project public surfaces; the builder never guesses `src/index.ts`. Internal
file dependencies crossing project boundaries aggregate into project dependencies.
Typed relations cover containment, membership, declarations, exports, dependencies,
bindings, explicit symbol nesting, and project dependencies. An orphan is exactly a
parsed, non-entry-point file with no incoming or outgoing internal dependency.

Knowledge identities use SHA-256 under the versioned `knowledge:v1` namespace, and
all arrays have explicit deterministic ordering. The builder does not read source or
workspace configuration because the scanner and composition boundary own I/O.
Feature inference and natural-language knowledge remain deferred so structural
evidence exists before generated data.

The CLI JSON serialization boundary is separate from the domain models. Schema 3
constructs an explicit DTO, preserves analysis and resolution, adds knowledge nodes,
relations and project dependencies, and copies supported fields intentionally,
and omits timestamps, durations, source contents, and per-file absolute paths. This
keeps machine-readable CLI compatibility deliberate without coupling parser model
evolution directly to an external wire format.

The context builder is a pure selection and assembly stage above repository
knowledge. The implemented pipeline is:

```text
Repository → Filesystem Scanner → Repository Scan → Tree-sitter Parser
→ Repository Analysis → Module Resolver → Resolved Repository Analysis
→ Knowledge Builder → Repository Knowledge Model → Context Builder
→ Deterministic Context Package → MCP, Coding Agents, Search, Wiki — planned
```

The context builder currently performs its own resolver-backed breadth expansion for
file dependencies because it also assigns feature-specific ranks and source evidence.
Its generic cycle-safe adjacency traversal is a candidate for later reuse through
`core/graph`; target resolution, ranking, omissions, excerpt construction, and source
integrity remain context-builder responsibilities.

File, symbol, folder, and project targets use one explicit lookup strategy. Integer
priority classes plus path, source location, and stable-ID tie breakers rank
candidates. Targets and hierarchy are mandatory; optional entities stop at validated
limits and receive fixed selection reasons. Relations require both endpoints.
Aggregated omissions are contractual.

File declarations rank before bound and dependency symbols. Incoming binding
evidence selects a file but is not attributed to arbitrary declarations. Project
context explicitly includes directly adjacent project nodes and connecting
dependency records without selecting every adjacent-project file. Project files rank
public surfaces, cross-project participants, production source, tests, then metadata.
Folder files use source-first ranking; folder depth is exact descendant-folder edge
distance, while mandatory containment for selected files may add deeper folders.

Source selection precedes an injected provider boundary. The CLI reads only
scanner-listed paths; the builder verifies identity, normalized path, declared and
recomputed hashes, binary status, and size. Parser ranges drive whole-line excerpts,
with deterministic surrounding lines, overlap merging, truncation, and total budgets.
Excerpt requests are derived after bounded symbol selection, so symbol-backed ranges
reference selected symbols. Relation priority preserves target relationships and
project dependencies before optional containment. Per-file dependency metrics remain
repository-wide. `SOURCE_DISABLED` counts all selected files when source is disabled
for the package and does not indicate provider failure.

Context schema `"1"` is independent of analyze schema `"3"`. IDs cover structural
identity, normalized options, and selected hashes when source is enabled. Persistence
is deferred with caching infrastructure; semantic relevance is deferred until after
structural evidence; token counting belongs to future model-specific packing.

The API still implements only `GET /health`. The web application consumes a generated
artifact rather than repository scans. The MCP entry point remains scaffolding.

The implemented graph visualization flow is:

```text
Repository → CLI analysis → RepositoryKnowledge → RepositoryGraph
→ GraphProjection → .lattice/graph.json → configured Next.js loader
→ browser-safe JSON → Cytoscape visualization
```

Repository graph artifact schema `"1"` is independent of analyze schema `"3"` and
projection schema `"1"`. It contains repository identity without an absolute path,
normalized view options, validated counts, and the projection. The CLI may replace
only an existing valid Lattice graph artifact and uses a same-directory atomic write.
The Next.js route reads only `LATTICE_GRAPH_PATH`, disables caching, validates the
artifact again, and never exposes the configured path.

Repository visualization is progressive: the client initially projects three
hierarchy edges from the repository root, can reveal or collapse three-level branch
increments, and can isolate a node with its complete structural subtree and ancestor
chain without sibling branches. This is presentation state only; it neither changes
the artifact nor derives new repository facts.

## 8. Planned architecture

> **Planned — not implemented.**

Repository graph projections will feed planned feature libraries. Data-access adapters will eventually persist canonical knowledge and derived artifacts. Feature libraries will compose wiki, search, and context-building behavior. Wiki pages will use stable page identities, one primary structural target, evidence-backed sections, related-node links, relationship summaries, optional source references, and separately stored generated prose that cites node/relation evidence IDs. LLM assistance will remain optional, provider-independent, validated, and downstream of deterministic analysis. The web, API, CLI, and MCP entry points will expose those shared capabilities without forming a microservice architecture.

## 9. Architectural decision log

| Date       | Decision                                                                             | Status   | Rationale                                                                                                                                                          |
| ---------- | ------------------------------------------------------------------------------------ | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 2026-07-20 | Use an Nx integrated monorepo                                                        | Accepted | Centralizes project orchestration, caching, graph analysis, and enforceable boundaries.                                                                            |
| 2026-07-20 | Use npm as the package manager                                                       | Accepted | Provides a standard cross-platform workflow and matches the repository requirement.                                                                                |
| 2026-07-20 | Use TypeScript as the primary language                                               | Accepted | Enables strict, shared contracts across browser and Node entry points.                                                                                             |
| 2026-07-20 | Keep separate web, API, CLI, and MCP entry points                                    | Accepted | Keeps transport and bootstrapping concerns explicit while sharing libraries.                                                                                       |
| 2026-07-20 | Organize libraries by core, data access, features, integrations, and shared concerns | Accepted | Makes dependency direction and ownership visible and enforceable.                                                                                                  |
| 2026-07-20 | Use a local-first architecture                                                       | Accepted | Repository contents and generated knowledge should remain local by default; cloud services are optional.                                                           |
| 2026-07-20 | Prefer deterministic analysis before LLM-assisted interpretation                     | Accepted | Produces reproducible evidence and limits untrusted inference to appropriate boundaries.                                                                           |
| 2026-07-20 | Keep repository I/O behind an injected filesystem adapter                            | Accepted | Keeps scanner policy separate from Node I/O, makes failures explicit, and supports deterministic tests.                                                            |
| 2026-07-20 | Derive file identity from normalized relative paths and content hashes from bytes    | Accepted | Makes unchanged scan records stable and provides deterministic inputs for future incremental indexing.                                                             |
| 2026-07-20 | Allow the indexer to depend on the public filesystem abstraction                     | Accepted | The scanner domain orchestrates repository discovery while direct filesystem operations remain in the adapter; the exception is limited to the exact public alias. |
| 2026-07-20 | Use Tree-sitter as the deterministic syntax layer                                    | Accepted | Tree-sitter provides resilient concrete syntax trees without introducing compiler services; compatible Node and grammar versions are pinned.                       |
| 2026-07-20 | Initially parse only JavaScript, JSX, TypeScript, and TSX                            | Accepted | A narrow related-language scope provides useful structure while keeping extraction rules explicit and testable.                                                    |
| 2026-07-20 | Return a language-independent repository-analysis model                              | Accepted | Downstream components depend on stable source concepts rather than Tree-sitter node types or grammar details.                                                      |
| 2026-07-20 | Isolate syntax diagnostics and hard failures per file                                | Accepted | Partial or changing files must not invalidate useful deterministic analysis from the rest of a repository.                                                         |
| 2026-07-20 | Keep deterministic module resolution as a separate analyzer stage                    | Accepted | Resolution consumes scanner/parser metadata without reparsing or filesystem traversal and keeps syntax extraction focused.                                         |
| 2026-07-20 | Version resolved CLI analysis output as schema 2                                     | Accepted | Adding module, dependency, binding, unresolved, and cycle records materially changes the machine-readable contract.                                                |
| 2026-07-20 | Represent unresolved relationships structurally                                      | Accepted | Missing and ambiguous relationships are normal repository facts and must not discard otherwise useful analysis.                                                    |
| 2026-07-20 | Give explicit exports precedence and reject ambiguous export-all names               | Accepted | Deterministic consumers must never receive an arbitrary target when multiple star exports expose the same name.                                                    |
| 2026-07-20 | Build repository hierarchy as a separate deterministic stage                         | Accepted | Keeps structural knowledge reproducible and parsing and resolution focused.                                                                                        |
| 2026-07-20 | Use explicit injected project metadata instead of folder-name inference              | Accepted | Workspace configuration is authoritative; arbitrary folder naming is not project semantics.                                                                        |
| 2026-07-20 | Treat configured entry points as the only source of project-public APIs              | Accepted | Exported implementation files are not necessarily package surfaces, so guessed index files would create false public contracts.                                    |
| 2026-07-20 | Version analyze JSON structural-knowledge output as schema 3                         | Accepted | Knowledge nodes, relations, dependencies, and metrics materially change the machine-readable contract.                                                             |
| 2026-07-20 | Establish structural knowledge before generated knowledge                            | Accepted | Deterministic evidence and provenance must precede optional natural-language or semantic inference.                                                                |
| 2026-07-20 | Build deterministic bounded context before semantic retrieval                        | Accepted | Structural ranking is reproducible and useful without embeddings.                                                                                                  |
| 2026-07-20 | Inject context source access                                                         | Accepted | Selection cannot traverse files outside scanner authority.                                                                                                         |
| 2026-07-20 | Make selection reasons and omissions contractual                                     | Accepted | Consumers can explain inclusion and detect limit exclusions.                                                                                                       |
| 2026-07-20 | Version context packages independently as schema 1                                   | Accepted | Target packages are separate from full analyze schema 3.                                                                                                           |
| 2026-07-20 | Expose context as a separate CLI command                                             | Accepted | Analyze remains stable while target context has its own contract.                                                                                                  |
| 2026-07-22 | Treat structural knowledge as the canonical property graph                           | Accepted | Graph operations reuse knowledge nodes, relations, and IDs instead of creating a second source of repository facts.                                                |
| 2026-07-22 | Version bounded graph projections independently as schema 1                          | Accepted | Visualization-safe transport records evolve independently from analyze schema 3 and contain no UI-library or layout state.                                         |
| 2026-07-22 | Keep graph artifact generation in the CLI and visualization in web                   | Accepted | The browser never analyzes repositories; deterministic evidence crosses the boundary through a validated, versioned artifact.                                      |

## 10. Documentation-update rules

Update this file whenever components, project responsibilities, dependency rules, runtime topology, data flow, or architectural decisions change. Update `DEBUG.md` for meaningful investigations and reusable failure modes, library READMEs when their responsibilities or APIs change, and the root README when setup or user-facing behavior changes. Documentation must describe implemented reality and clearly label planned behavior.
