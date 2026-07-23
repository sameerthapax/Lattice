import path from 'node:path';
import { fileURLToPath } from 'node:url';

const workspaceRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../..',
);

export default {
  resolve: {
    alias: {
      '@lattice/core-analyzer': path.join(
        workspaceRoot,
        'libs/core/analyzer/src/index.ts',
      ),
      '@lattice/core-indexer': path.join(
        workspaceRoot,
        'libs/core/indexer/src/index.ts',
      ),
      '@lattice/core-parser': path.join(
        workspaceRoot,
        'libs/core/parser/src/index.ts',
      ),
      '@lattice/core-knowledge': path.join(
        workspaceRoot,
        'libs/core/knowledge/src/index.ts',
      ),
      '@lattice/core-graph': path.join(
        workspaceRoot,
        'libs/core/graph/src/index.ts',
      ),
      '@lattice/filesystem': path.join(
        workspaceRoot,
        'libs/data-access/filesystem/src/index.ts',
      ),
      '@lattice/context-builder': path.join(
        workspaceRoot,
        'libs/features/context-builder/src/index.ts',
      ),
    },
  },
};
