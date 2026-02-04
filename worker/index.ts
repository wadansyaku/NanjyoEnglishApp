export interface Env {
  DB: D1Database;
  ASSETS: Fetcher;
}

const jsonResponse = (data: unknown, init: ResponseInit = {}) =>
  new Response(JSON.stringify(data), {
    ...init,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      ...(init.headers || {})
    }
  });

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === '/api/healthz') {
      return jsonResponse({ ok: true });
    }

    if (url.pathname === '/api/lexemes/batch' && request.method === 'POST') {
      return jsonResponse({ ok: true });
    }

    if (url.pathname.startsWith('/api/')) {
      return jsonResponse({ ok: false, message: 'Not found.' }, { status: 404 });
    }

    return env.ASSETS.fetch(request);
  }
};
