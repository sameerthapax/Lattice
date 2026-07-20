# Filesystem

This library owns controlled Node.js filesystem access for repository scanning. Its
`RepositoryFileSystem` interface covers path resolution, entry metadata,
deterministically ordered traversal, byte and optional text reads, and SHA-256
hashing. `NodeRepositoryFileSystem` is the local adapter.

Public APIs are exported from `src/index.ts`. Keep implementation details private
to this library and import it through its `@lattice/*` alias.
