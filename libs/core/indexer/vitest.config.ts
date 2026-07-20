import path from 'node:path';
import { fileURLToPath } from 'node:url';

const workspaceRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../..',
);

export default {
  resolve: {
    alias: {
      '@lattice/filesystem': path.join(
        workspaceRoot,
        'libs/data-access/filesystem/src/index.ts',
      ),
    },
  },
};
