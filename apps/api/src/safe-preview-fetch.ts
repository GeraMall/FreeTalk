import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';

// Only public unicast destinations; DNS is pinned to the validated address for
// the actual socket, including after each redirect (no DNS rebinding window).
export function publicPreviewAddress(address: string): boolean {
  if (isIP(address) === 4) {
    const [a = 0, b = 0, c = 0] = address.split('.').map(Number);
    return !(
      a === 0 ||
      a === 10 ||
      a === 127 ||
      a >= 224 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && (b === 0 || b === 168 || (b === 88 && c === 99))) ||
      (a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100))) ||
      (a === 203 && b === 0 && c === 113)
    );
  }
  if (isIP(address) !== 6) return false;
  const [first, second = '0'] = address.split(':');
  const head = parseInt(first!, 16);
  const subnet = parseInt(second || '0', 16);
  return (
    head >= 0x2000 &&
    head <= 0x3fff &&
    head !== 0x2002 &&
    !(head === 0x2001 && (subnet <= 0x1ff || subnet === 0xdb8)) &&
    !/^3fff:/i.test(address)
  );
}

export function previewUrl(input: string): URL {
  const url = new URL(input);
  if (
    !['https:', 'http:'].includes(url.protocol) ||
    url.username ||
    url.password ||
    (url.port && url.port !== (url.protocol === 'https:' ? '443' : '80')) ||
    url.hostname === 'localhost' ||
    /\.(?:localhost|local|internal)$/i.test(url.hostname)
  )
    throw new Error('Unsupported preview destination');
  const literal = url.hostname.replace(/^\[|\]$/g, '');
  if (isIP(literal) && !publicPreviewAddress(literal)) throw new Error('Non-public destination');
  url.hash = '';
  return url;
}

let active = 0;
export async function fetchPublicPreview(
  input: string,
  maxBytes = 512 * 1024,
  allowTruncatedHtml = false,
) {
  if (active >= 8) throw new Error('Preview capacity reached');
  active++;
  const deadline = Date.now() + 6000;
  try {
    let url = previewUrl(input);
    for (let redirects = 0; redirects <= 3; redirects++) {
      const hostname = url.hostname.replace(/^\[|\]$/g, '');
      const records = isIP(hostname)
        ? [{ address: hostname, family: isIP(hostname) }]
        : await Promise.race([
            lookup(hostname, { all: true }),
            new Promise<never>((_, reject) => {
              const timer = setTimeout(
                () => reject(new Error('DNS timeout')),
                Math.max(1, deadline - Date.now()),
              );
              timer.unref();
            }),
          ]);
      if (!records.length || records.some((entry) => !publicPreviewAddress(entry.address)))
        throw new Error('Non-public preview destination');
      const address = records[0]!;
      const result = await new Promise<{
        status: number;
        location?: string;
        type: string;
        body: Buffer;
      }>((resolve, reject) => {
        const request = (url.protocol === 'https:' ? httpsRequest : httpRequest)(
          url,
          {
            method: 'GET',
            agent: false,
            family: address.family,
            lookup: (_host, _options, done) => done(null, address.address, address.family),
            headers: {
              'user-agent': 'Trlka-LinkPreview/1.0',
              accept: 'text/html,application/json,image/*;q=0.8',
              'accept-encoding': 'identity',
            },
          },
          (response) => {
            const status = response.statusCode ?? 0;
            if (status >= 300 && status < 400) {
              response.destroy();
              resolve({
                status,
                location: response.headers.location,
                type: '',
                body: Buffer.alloc(0),
              });
              return;
            }
            const truncate =
              allowTruncatedHtml &&
              /^text\/html(?:;|$)/i.test(response.headers['content-type'] ?? '');
            if (
              status !== 200 ||
              (!truncate && Number(response.headers['content-length'] ?? 0) > maxBytes)
            ) {
              response.destroy();
              reject(new Error('Invalid preview response'));
              return;
            }
            const chunks: Buffer[] = [];
            let size = 0;
            response.on('data', (chunk: Buffer) => {
              if (truncate && size + chunk.length > maxBytes) {
                chunks.push(chunk.subarray(0, Math.max(0, maxBytes - size)));
                resolve({
                  status,
                  type: response.headers['content-type'] ?? '',
                  body: Buffer.concat(chunks),
                });
                response.destroy();
                return;
              }
              size += chunk.length;
              if (size > maxBytes) request.destroy(new Error('Preview too large'));
              else chunks.push(chunk);
            });
            response.on('error', reject);
            response.on('end', () =>
              resolve({
                status,
                type: response.headers['content-type'] ?? '',
                body: Buffer.concat(chunks),
              }),
            );
          },
        );
        const timer = setTimeout(
          () => request.destroy(new Error('Preview timeout')),
          Math.max(1, deadline - Date.now()),
        );
        request.on('close', () => clearTimeout(timer));
        request.on('error', reject);
        request.end();
      });
      if (result.status >= 300 && result.status < 400 && result.location) {
        url = previewUrl(new URL(result.location, url).toString());
        continue;
      }
      return { ...result, url: url.toString() };
    }
    throw new Error('Too many preview redirects');
  } finally {
    active--;
  }
}
