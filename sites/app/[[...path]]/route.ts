import { env } from 'cloudflare:workers';
import { getChatGPTUser } from '../chatgpt-auth';
import { DashboardService } from '../../core/src/service.mjs';
import { D1Store } from '../../core/src/d1-store.mjs';
import { createSitesApp } from '../../core/src/sites-app.mjs';
import { legalResponse } from '../../lib/legal.mjs';
import { webResource } from '../../core/src/web-resource.mjs';

export const dynamic = 'force-dynamic';

async function handle(request: Request): Promise<Response> {
  const legal = legalResponse(new URL(request.url).pathname);
  if (legal && request.method === 'GET') return legal;
  const runtime = env as unknown as Record<string, any>;
  const names: Record<string, string> = { googleClientId: 'GOOGLE_CLIENT_ID', googleClientSecret: 'GOOGLE_CLIENT_SECRET', encryptionKey: 'TOKEN_ENCRYPTION_KEY' };
  const missing = Object.keys(names).filter(name => typeof runtime[names[name]] !== 'string' || !runtime[names[name]]);
  if (!runtime.DB) missing.push('database');
  const config = {
    publicOrigin: runtime.PUBLIC_ORIGIN || 'https://example.invalid',
    googleClientId: runtime.GOOGLE_CLIENT_ID,
    googleClientSecret: runtime.GOOGLE_CLIENT_SECRET,
    encryptionKey: runtime.TOKEN_ENCRYPTION_KEY,
  };
  const app = createSitesApp({
    config,
    readiness: { ready: missing.length === 0, missing },
    webResource,
    createService: () => new DashboardService({ store: new D1Store(runtime.DB), config }),
  });
  const user = await getChatGPTUser();
  return app(request, { userId: user?.userId });
}

export const GET = handle;
export const POST = handle;
