# Indexer

The indexer provides deterministic repository discovery. It validates a repository,
applies hardcoded, `.gitignore`, and `.latticeignore` exclusions, skips oversized
and binary files, identifies languages by extension, and returns stable file
metadata sorted by repository-relative path.

```ts
import { scanRepository } from '@lattice/core-indexer';

const scan = await scanRepository({ rootPath: '.' });
```

The default maximum file size is 10 MiB and can be changed with
`maxFileSizeBytes`. File IDs are SHA-256 hashes of normalized relative paths;
content hashes are SHA-256 hashes of file bytes. `scannedAt` intentionally records
the scan time, while all repository-derived fields remain stable for an unchanged
repository.

Filesystem access is injected through `RepositoryScanner` and its
`RepositoryFileSystem` dependency. Public APIs are exported from `src/index.ts`.
