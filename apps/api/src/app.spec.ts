import { afterEach, describe, expect, it } from 'vitest';

import { createApp } from './app/create-app';

const apps = new Set<ReturnType<typeof createApp>>();

afterEach(async () => {
  await Promise.all([...apps].map((app) => app.close()));
  apps.clear();
});

describe('GET /health', () => {
  it('reports that the API is healthy', async () => {
    const app = createApp();
    apps.add(app);

    const response = await app.inject({ method: 'GET', url: '/health' });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      status: 'ok',
      service: 'lattice-api',
    });
  });
});
