import { mkdir, readFile, rename, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';

import {
  parseRepositoryGraphArtifact,
  serializeRepositoryGraphArtifact,
  type RepositoryGraphArtifact,
} from '@lattice/core-graph';

export type GraphArtifactWriteErrorCode =
  'OUTPUT_FILE_EXISTS' | 'OUTPUT_WRITE_FAILED';

export class GraphArtifactWriteError extends Error {
  public constructor(
    public readonly code: GraphArtifactWriteErrorCode,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = 'GraphArtifactWriteError';
  }
}

export interface WriteGraphArtifactInput {
  readonly artifact: RepositoryGraphArtifact;
  readonly repositoryRoot: string;
  readonly outputPath?: string;
  readonly pretty: boolean;
}

export async function writeGraphArtifact(
  input: WriteGraphArtifactInput,
): Promise<string> {
  const outputPath = path.resolve(
    input.repositoryRoot,
    input.outputPath ?? '.lattice/graph.json',
  );
  await ensureReplaceable(outputPath);
  await mkdir(path.dirname(outputPath), { recursive: true });
  const temporaryPath = path.join(
    path.dirname(outputPath),
    `.${path.basename(outputPath)}.${process.pid}.tmp`,
  );
  try {
    await writeFile(
      temporaryPath,
      serializeRepositoryGraphArtifact(input.artifact, input.pretty),
      { encoding: 'utf8', flag: 'wx' },
    );
    await rename(temporaryPath, outputPath);
    return outputPath;
  } catch (error: unknown) {
    await unlink(temporaryPath).catch(() => undefined);
    throw new GraphArtifactWriteError(
      'OUTPUT_WRITE_FAILED',
      `Cannot write graph artifact: ${outputPath}`,
      { cause: error },
    );
  }
}

async function ensureReplaceable(outputPath: string): Promise<void> {
  let content: string;
  try {
    content = await readFile(outputPath, 'utf8');
  } catch (error: unknown) {
    if (isNodeError(error) && error.code === 'ENOENT') return;
    throw new GraphArtifactWriteError(
      'OUTPUT_WRITE_FAILED',
      `Cannot inspect graph output: ${outputPath}`,
      { cause: error },
    );
  }
  try {
    parseRepositoryGraphArtifact(JSON.parse(content));
  } catch (error: unknown) {
    throw new GraphArtifactWriteError(
      'OUTPUT_FILE_EXISTS',
      `Refusing to overwrite a file that is not a valid Lattice graph artifact: ${outputPath}`,
      { cause: error },
    );
  }
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error;
}
