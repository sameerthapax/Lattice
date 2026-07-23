import { readFile } from 'node:fs/promises';

import {
  parseRepositoryGraphArtifact,
  RepositoryGraphArtifactError,
  type RepositoryGraphArtifact,
} from '@lattice/core-graph';

export type GraphLoadErrorCode =
  | 'GRAPH_PATH_NOT_CONFIGURED'
  | 'GRAPH_FILE_NOT_FOUND'
  | 'GRAPH_FILE_UNREADABLE'
  | 'GRAPH_JSON_INVALID'
  | 'GRAPH_SCHEMA_UNSUPPORTED'
  | 'GRAPH_ARTIFACT_INVALID';

export type GraphLoadResult =
  | { readonly ok: true; readonly artifact: RepositoryGraphArtifact }
  | {
      readonly ok: false;
      readonly error: {
        readonly code: GraphLoadErrorCode;
        readonly message: string;
      };
    };

export async function loadConfiguredGraphArtifact(
  configuredPath = process.env['LATTICE_GRAPH_PATH'],
): Promise<GraphLoadResult> {
  if (!configuredPath)
    return failure(
      'GRAPH_PATH_NOT_CONFIGURED',
      'Set LATTICE_GRAPH_PATH to a generated Lattice graph artifact.',
    );
  let text: string;
  try {
    text = await readFile(configuredPath, 'utf8');
  } catch (error: unknown) {
    return isNodeError(error) && error.code === 'ENOENT'
      ? failure(
          'GRAPH_FILE_NOT_FOUND',
          'The configured graph artifact was not found.',
        )
      : failure(
          'GRAPH_FILE_UNREADABLE',
          'The configured graph artifact cannot be read.',
        );
  }
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return failure(
      'GRAPH_JSON_INVALID',
      'The configured graph artifact is not valid JSON.',
    );
  }
  try {
    return { ok: true, artifact: parseRepositoryGraphArtifact(value) };
  } catch (error: unknown) {
    return error instanceof RepositoryGraphArtifactError &&
      error.code === 'UNSUPPORTED_SCHEMA_VERSION'
      ? failure('GRAPH_SCHEMA_UNSUPPORTED', error.message)
      : failure(
          'GRAPH_ARTIFACT_INVALID',
          error instanceof Error
            ? error.message
            : 'The graph artifact is invalid.',
        );
  }
}

function failure(code: GraphLoadErrorCode, message: string): GraphLoadResult {
  return { ok: false, error: { code, message } };
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error;
}
