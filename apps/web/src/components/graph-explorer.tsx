'use client';

import { ArrowClockwise, Graph } from '@phosphor-icons/react';
import type { RepositoryGraphArtifact } from '@lattice/core-graph';
import { useCallback, useEffect, useState } from 'react';

import { RepositoryGraphViewer } from './repository-graph-viewer';
import { RepositoryLoader } from './repository-loader';
import { Alert } from './ui/alert';
import { Button } from './ui/button';

type LoadState =
  | { readonly status: 'loading' }
  | { readonly status: 'ready'; readonly artifact: RepositoryGraphArtifact }
  | {
      readonly status: 'error';
      readonly code: string;
      readonly message: string;
    };

export function GraphExplorer() {
  const [state, setState] = useState<LoadState>({ status: 'loading' });

  const load = useCallback(async (preserveViewer = false) => {
    if (!preserveViewer) setState({ status: 'loading' });
    try {
      const response = await fetch('/api/graph', { cache: 'no-store' });
      const result: unknown = await response.json();
      if (!isGraphResponse(result))
        throw new Error('The graph endpoint returned an invalid response.');
      setState(
        result.ok
          ? { status: 'ready', artifact: result.artifact }
          : {
              status: 'error',
              code: result.error.code,
              message: result.error.message,
            },
      );
    } catch (error: unknown) {
      setState({
        status: 'error',
        code: 'GRAPH_REQUEST_FAILED',
        message:
          error instanceof Error ? error.message : 'Unable to load the graph.',
      });
    }
  }, []);

  useEffect(() => {
    void load(false);
  }, [load]);

  if (state.status === 'loading') return <GraphLoading />;
  if (state.status === 'error')
    return (
      <div className="mx-auto flex min-h-[100dvh] max-w-3xl items-center px-5 py-12">
        <div className="w-full space-y-5">
          <div className="flex size-11 items-center justify-center rounded-xl bg-muted">
            <Graph size={22} weight="duotone" />
          </div>
          <div>
            <p className="font-mono text-xs text-muted-foreground">
              {state.code}
            </p>
            <h1 className="mt-2 text-3xl font-semibold tracking-tight">
              Graph artifact unavailable
            </h1>
          </div>
          <Alert>{state.message}</Alert>
          <Button onClick={() => void load(false)}>
            <ArrowClockwise size={16} /> Retry
          </Button>
        </div>
      </div>
    );
  return (
    <RepositoryGraphViewer
      key={`${state.artifact.repository.id}:${state.artifact.view.kind}`}
      artifact={state.artifact}
      onReload={() => load(true)}
    />
  );
}

function GraphLoading() {
  return <RepositoryLoader label="Loading repository graph" fullscreen />;
}

function isGraphResponse(value: unknown): value is
  | { readonly ok: true; readonly artifact: RepositoryGraphArtifact }
  | {
      readonly ok: false;
      readonly error: { readonly code: string; readonly message: string };
    } {
  if (typeof value !== 'object' || value === null || !('ok' in value))
    return false;
  if (value.ok === true) return 'artifact' in value;
  if (value.ok !== false || !('error' in value)) return false;
  const error = value.error;
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    typeof error.code === 'string' &&
    'message' in error &&
    typeof error.message === 'string'
  );
}
