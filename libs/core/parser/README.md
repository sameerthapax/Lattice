# core-parser

`@lattice/core-parser` is Lattice's deterministic source-syntax boundary. It
consumes an existing `RepositoryScan`, reads only files named by that scan through
an injected `RepositoryFileSystem`, verifies every content hash, and returns a
language-independent `RepositoryAnalysis`. Tree-sitter nodes and trees remain
internal to this library.

## Public API

```ts
import { analyzeRepository } from '@lattice/core-parser';
import { NodeRepositoryFileSystem } from '@lattice/filesystem';

const analysis = await analyzeRepository({
  scan,
  fileSystem: new NodeRepositoryFileSystem(),
  now: () => new Date(), // optional injectable clock
});
```

The result contains repository counts, sorted parsed files, isolated failures,
and each file's symbols, static imports, exports, and syntax diagnostics. Source
locations use one-based lines and zero-based UTF-8 byte columns.

## Supported languages

- TypeScript (`.ts`)
- TSX (`.tsx`)
- JavaScript (`.js`)
- JSX (`.jsx`)

Other scanner languages, including `Unknown`, are counted as skipped and are not
errors. The explicit scanner-to-parser mapping does not treat `Unknown` as
parseable.

## Output and identity

Symbols include functions, arrow/function-expression variables, classes, class
methods and constructors, interfaces, type aliases, enums, exported variables,
and clearly named object methods. Class members reference their class through
`parentSymbolId`. Top-level object methods use qualified names such as
`handlers.load`; nested lexical declarations are not modeled in this milestone.

Symbol IDs are SHA-256 hashes of the file ID, symbol kind, qualified name, and
declaration start position. Import and export IDs use equivalent stable structural
inputs. IDs and collection ordering are deterministic for identical scans and
contents. Moving a declaration can change its ID in this milestone.

## Errors and determinism

Files are processed sequentially. Parsed files and failures are sorted by relative
path; symbols, imports, exports, and diagnostics are explicitly sorted by source
position and stable tie-breakers. Inject `now` when comparing complete results.

Tree-sitter error or missing nodes produce file diagnostics while recoverable
symbols remain available. Read failures, content changes after scanning, and
unusable parser results become per-file `ParseFailure` records. Unsupported
languages are skipped. Parser initialization failures remain repository-level
errors. Public messages do not include source content or low-level stack traces.

## Dependency constraint

The parser pins `tree-sitter@0.21.1`, `tree-sitter-javascript@0.23.1`, and
`tree-sitter-typescript@0.23.2`. The TypeScript grammar declares a `tree-sitter`
`^0.21` peer while the newer JavaScript `0.25` grammar requires `^0.25`; JavaScript
`0.23.1` is the peer-compatible grammar used by this Node binding set. Do not force
incompatible peer versions.

## Current limitations

The output is syntactic, not compiler-semantic. Cross-file static ES-module
resolution belongs to `@lattice/core-analyzer`; the parser only preserves the
specifier and import/export names needed by that stage. CommonJS `require`, dynamic
`import()`, nested lexical scope modeling, call graphs, type resolution, persistence,
knowledge generation, and AI interpretation remain out of scope. No syntax trees or
source contents are persisted in the public result.
