import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../..',
);
export default {
  resolve: {
    alias: {
      '@lattice/core-indexer': path.join(
        root,
        'libs/core/indexer/src/index.ts',
      ),
      '@lattice/core-parser': path.join(root, 'libs/core/parser/src/index.ts'),
      '@lattice/core-analyzer': path.join(
        root,
        'libs/core/analyzer/src/index.ts',
      ),
      '@lattice/core-knowledge': path.join(
        root,
        'libs/core/knowledge/src/index.ts',
      ),
      '@lattice/filesystem': path.join(
        root,
        'libs/data-access/filesystem/src/index.ts',
      ),
    },
  },
};
