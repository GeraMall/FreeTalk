import { transitionHa, type HaNode, type HaRegistry } from './ha-registry';

interface Env {
  HA_REGISTRY: DurableObjectNamespace;
  HA_MOSCOW_TOKEN: string;
  HA_PETERSBURG_TOKEN: string;
  HA_ADMIN_TOKEN: string;
}

const json = (value: unknown, status = 200) =>
  new Response(JSON.stringify(value), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  });

async function equalSecret(actual: string, expected?: string) {
  if (!expected || expected.length < 32) return false;
  const hash = async (s: string) =>
    new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)));
  const [a, b] = await Promise.all([hash(actual), hash(expected)]);
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

export default {
  async fetch(request: Request, env: Env) {
    const url = new URL(request.url);
    if (
      url.search ||
      ![
        '/state',
        '/eligibility',
        '/begin-fence',
        '/claim',
        '/bootstrap',
        '/handoff',
        '/cancel-fence',
      ].includes(url.pathname)
    )
      return json({ error: 'NOT_FOUND' }, 404);
    const token = request.headers.get('authorization')?.replace(/^Bearer /, '') ?? '';
    let actor: HaNode | 'admin' | undefined;
    if (await equalSecret(token, env.HA_MOSCOW_TOKEN)) actor = 'moscow';
    else if (await equalSecret(token, env.HA_PETERSBURG_TOKEN)) actor = 'petersburg';
    else if (await equalSecret(token, env.HA_ADMIN_TOKEN)) actor = 'admin';
    if (!actor) return json({ error: 'UNAUTHORIZED' }, 401);
    if (
      (url.pathname === '/state' && request.method !== 'GET') ||
      (url.pathname !== '/state' && request.method !== 'POST')
    )
      return json({ error: 'METHOD_NOT_ALLOWED' }, 405);
    if (Number(request.headers.get('content-length') ?? 0) > 1024)
      return json({ error: 'TOO_LARGE' }, 413);
    const body = request.method === 'GET' ? '' : await request.text();
    if (body.length > 1024) return json({ error: 'TOO_LARGE' }, 413);
    const id = env.HA_REGISTRY.idFromName('trlka-production-ha-v1');
    return env.HA_REGISTRY.get(id).fetch(
      new Request('https://registry' + url.pathname, {
        method: request.method,
        headers: { 'x-ha-actor': actor },
        ...(body ? { body } : {}),
      }),
    );
  },
};

export class HaRegistryObject {
  constructor(private readonly state: DurableObjectState) {}
  async fetch(request: Request) {
    const operation = new URL(request.url).pathname.slice(1);
    const actor = request.headers.get('x-ha-actor') as HaNode | 'admin';
    if (!['moscow', 'petersburg', 'admin'].includes(actor))
      return json({ error: 'UNAUTHORIZED' }, 401);
    if (operation === 'state') {
      const value = await this.state.storage.get<HaRegistry>('state');
      return value ? json(value) : json({ error: 'NOT_INITIALIZED' }, 503);
    }
    try {
      const input = await request.json<Parameters<typeof transitionHa>[3]>();
      const value = await this.state.storage.transaction(async (txn) => {
        const old = await txn.get<HaRegistry>('state');
        const next = transitionHa(old, actor, operation, input);
        await txn.put('state', next);
        return next;
      });
      return json(value);
    } catch (error) {
      const code = error instanceof Error ? error.message : 'INVALID_REQUEST';
      const allowed = [
        'NOT_INITIALIZED',
        'STALE_EPOCH',
        'INVALID_ELIGIBILITY',
        'SYNC_BARRIER_REQUIRED',
        'FENCING_AND_SYNC_REQUIRED',
        'FENCE_IN_PROGRESS',
        'FORBIDDEN_TRANSITION',
      ];
      return json({ error: allowed.includes(code) ? code : 'INVALID_REQUEST' }, 409);
    }
  }
}
