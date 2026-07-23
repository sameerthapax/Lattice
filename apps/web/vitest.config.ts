import path from 'node:path';
import { fileURLToPath } from 'node:url';

const workspaceRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../..',
);

export default {
  resolve: {
    alias: {
      '@': path.join(workspaceRoot, 'apps/web/src'),
      '@lattice/core-graph': path.join(
        workspaceRoot,
        'libs/core/graph/src/index.ts',
      ),
    },
  },
};
