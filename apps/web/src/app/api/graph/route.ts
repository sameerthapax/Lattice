import { loadConfiguredGraphArtifact } from '../../../lib/load-graph-artifact';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(): Promise<Response> {
  const result = await loadConfiguredGraphArtifact();
  const status = result.ok
    ? 200
    : result.error.code === 'GRAPH_FILE_NOT_FOUND'
      ? 404
      : result.error.code === 'GRAPH_PATH_NOT_CONFIGURED'
        ? 500
        : 422;
  return Response.json(result, {
    status,
    headers: { 'Cache-Control': 'no-store, max-age=0' },
  });
}
