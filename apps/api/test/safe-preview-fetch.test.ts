import { EventEmitter } from 'node:events';
import { beforeEach, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ lookup: vi.fn(), request: vi.fn() }));
vi.mock('node:dns/promises', () => ({ lookup: mocks.lookup }));
vi.mock('node:https', () => ({ request: mocks.request }));
vi.mock('node:http', () => ({ request: mocks.request }));
import { fetchPublicPreview, publicPreviewAddress } from '../src/safe-preview-fetch.js';
beforeEach(() => {
  mocks.lookup.mockReset();
  mocks.request.mockReset();
});
it('denies private, reserved, mapped and transition IP ranges', () => {
  for (const ip of [
    '0.0.0.0',
    '10.1.1.1',
    '127.0.0.1',
    '169.254.169.254',
    '100.100.100.200',
    '172.20.1.1',
    '192.168.0.1',
    '198.18.0.1',
    '224.0.0.1',
    '::1',
    'fc00::1',
    'fe80::1',
    '::ffff:8.8.8.8',
    '2002:808:808::1',
    '2001:db8::1',
    '2001:100::1',
    '3fff::1',
  ])
    expect(publicPreviewAddress(ip), ip).toBe(false);
  for (const ip of ['8.8.8.8', '93.184.216.34', '2606:4700:4700::1111', '2001:4860:4860::8888'])
    expect(publicPreviewAddress(ip), ip).toBe(true);
});
it('rejects mixed public/private DNS before opening a socket', async () => {
  mocks.lookup.mockResolvedValue([
    { address: '8.8.8.8', family: 4 },
    { address: '10.0.0.1', family: 4 },
  ]);
  await expect(fetchPublicPreview('https://mixed.example/')).rejects.toThrow('Non-public');
  expect(mocks.request).not.toHaveBeenCalled();
});
function response(status: number, headers: Record<string, string>, chunks: Buffer[]) {
  mocks.request.mockImplementationOnce((_url, options, callback) => {
    options.lookup('host', {}, (_error: unknown, address: string, family: number) => {
      expect(address).toBe('8.8.8.8');
      expect(family).toBe(4);
    });
    const req = Object.assign(new EventEmitter(), {
      end: () =>
        queueMicrotask(() => {
          const res = Object.assign(new EventEmitter(), {
            statusCode: status,
            headers,
            destroy: vi.fn(),
          });
          callback(res);
          for (const chunk of chunks) res.emit('data', chunk);
          res.emit('end');
          req.emit('close');
        }),
      destroy: (error: Error) => {
        req.emit('error', error);
        req.emit('close');
      },
    });
    return req;
  });
}
it('pins the socket address and rejects redirects into a private network', async () => {
  mocks.lookup.mockResolvedValue([{ address: '8.8.8.8', family: 4 }]);
  response(302, { location: 'http://127.0.0.1/admin' }, []);
  await expect(fetchPublicPreview('https://public.example/')).rejects.toThrow('Non-public');
  expect(mocks.request).toHaveBeenCalledTimes(1);
});
it('bounds chunked bodies without trusting content-length', async () => {
  mocks.lookup.mockResolvedValue([{ address: '8.8.8.8', family: 4 }]);
  response(200, { 'content-type': 'text/html' }, [Buffer.alloc(8), Buffer.alloc(8)]);
  await expect(fetchPublicPreview('https://public.example/', 10)).rejects.toThrow('too large');
});

it('can read a bounded metadata prefix from a large HTML page', async () => {
  mocks.lookup.mockResolvedValue([{ address: '8.8.8.8', family: 4 }]);
  response(200, { 'content-type': 'text/html', 'content-length': '1000000' }, [
    Buffer.from('<title>Example</title>'),
    Buffer.alloc(20),
  ]);
  const result = await fetchPublicPreview('https://public.example/', 10, true);
  expect(result.body.length).toBe(10);
  expect(result.body.toString()).toBe('<title>Exa');
});
