import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createConfiguredApp } from '../src/app-setup';
import { assertRequiredEnv } from '../src/main';

type ExpressHandler = (
  request: VercelRequest,
  response: VercelResponse,
) => unknown;

let handlerPromise: Promise<ExpressHandler> | undefined;

async function createHandler(): Promise<ExpressHandler> {
  const problems = assertRequiredEnv();
  if (problems.length > 0) {
    throw new Error(`Invalid production environment: ${problems.join('; ')}`);
  }

  const app = await createConfiguredApp();
  await app.init();
  return app.getHttpAdapter().getInstance() as ExpressHandler;
}

function getHandler(): Promise<ExpressHandler> {
  handlerPromise ??= createHandler().catch((error: unknown) => {
    handlerPromise = undefined;
    throw error;
  });
  return handlerPromise;
}

export default async function handler(
  request: VercelRequest,
  response: VercelResponse,
): Promise<void> {
  try {
    const expressHandler = await getHandler();
    await expressHandler(request, response);
  } catch (error: unknown) {
    console.error('[vercel] failed to initialize Nest application', error);
    if (!response.headersSent) {
      response.status(500).json({
        statusCode: 500,
        message: 'Application initialization failed',
      });
    }
  }
}
