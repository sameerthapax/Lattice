import path from 'node:path';
import { fileURLToPath } from 'node:url';

const workspaceRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../..',
);

export default {
  resolve: {
    alias: {
      '@lattice/core-knowledge': path.join(
        workspaceRoot,
        'libs/core/knowledge/src/index.ts',
      ),
    },
  },
};
