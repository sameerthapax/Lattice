import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

import type { RepositoryGraphArtifact } from '@lattice/core-graph';
import { afterEach, describe, expect, it } from 'vitest';

import { writeGraphArtifact } from './graph-output';

const directories: string[] = [];

afterEach(async () => {
  await Promise.all(
    directories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe('writeGraphArtifact', () => {
  it('creates parent directories and deterministically replaces its artifact', async () => {
    const repositoryRoot = await temporaryDirectory();
    const artifact = fixtureArtifact();
    const first = await writeGraphArtifact({
      artifact,
      repositoryRoot,
      pretty: false,
    });
    const firstContent = await readFile(first, 'utf8');
    const second = await writeGraphArtifact({
      artifact,
      repositoryRoot,
      pretty: false,
    });

    expect(first).toBe(path.join(repositoryRoot, '.lattice/graph.json'));
    expect(second).toBe(first);
    expect(await readFile(second, 'utf8')).toBe(firstContent);
  });

  it('resolves explicit relative output paths from the repository root', async () => {
    const repositoryRoot = await temporaryDirectory();
    const output = await writeGraphArtifact({
      artifact: fixtureArtifact(),
      repositoryRoot,
      outputPath: 'artifacts/repository.json',
      pretty: true,
    });
    expect(output).toBe(path.join(repositoryRoot, 'artifacts/repository.json'));
    expect(await readFile(output, 'utf8')).toContain('\n  "schemaVersion"');
  });

  it('refuses to overwrite unrelated content', async () => {
    const repositoryRoot = await temporaryDirectory();
    const output = path.join(repositoryRoot, 'existing.json');
    await writeFile(output, '{"belongsTo":"someone-else"}\n');

    await expect(
      writeGraphArtifact({
        artifact: fixtureArtifact(),
        repositoryRoot,
        outputPath: 'existing.json',
        pretty: false,
      }),
    ).rejects.toMatchObject({
      code: 'OUTPUT_FILE_EXISTS',
    });
  });
});

async function temporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'lattice-graph-'));
  directories.push(directory);
  return directory;
}

function fixtureArtifact(): RepositoryGraphArtifact {
  return {
    artifactKind: 'repository-graph',
    schemaVersion: '1',
    repository: { id: 'repo', name: 'fixture' },
    view: {
      kind: 'repository',
      targetNodeId: null,
      maxDepth: null,
      maxNodes: 5000,
      maxRelations: 20000,
    },
    summary: { nodeCount: 1, edgeCount: 0, omissionCount: 0 },
    graph: {
      schemaVersion: '1',
      rootNodeIds: ['repo'],
      nodes: [
        {
          id: 'repo',
          kind: 'repository',
          label: 'fixture',
          metadata: { projectCount: 0, fileCount: 0 },
        },
      ],
      edges: [],
      omissions: [],
    },
  };
}
