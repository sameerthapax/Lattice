import { createApp } from './app/create-app';

async function main(): Promise<void> {
  const app = createApp();

  try {
    await app.listen({
      host: process.env.HOST ?? '127.0.0.1',
      port: Number(process.env.PORT ?? 3001),
    });
  } catch (error: unknown) {
    app.log.error(error);
    process.exitCode = 1;
  }
}

void main();
