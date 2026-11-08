// Test-only reverse proxy: emulate distinct client IPs without weakening the API's rate limits.
// Never expose this fixture outside the loopback-only disposable CI environment.
import { createServer, request } from 'node:http';
import { requireLab, maxUsers } from './common.mjs';
requireLab();
const headers = (req) => {
  const client = Number(req.headers['x-capacity-client']);
  if (!Number.isInteger(client) || client < 0 || client >= maxUsers)
    throw Error('Invalid test client');
  return {
    ...req.headers,
    host: '127.0.0.1:8790',
    'x-forwarded-for': `10.20.${Math.floor(client / 250)}.${(client % 250) + 1}`,
  };
};
const server = createServer((req, res) => {
  let forwarded;
  try {
    forwarded = headers(req);
  } catch {
    res.writeHead(400).end();
    return;
  }
  const upstream = request(
    { host: '127.0.0.1', port: 8790, path: req.url, method: req.method, headers: forwarded },
    (response) => {
      res.writeHead(response.statusCode, response.headers);
      response.pipe(res);
    },
  );
  upstream.on('error', () => {
    if (!res.headersSent) res.writeHead(502);
    res.end();
  });
  req.pipe(upstream);
});
server.on('upgrade', (req, socket, head) => {
  let forwarded;
  try {
    forwarded = headers(req);
  } catch {
    socket.destroy();
    return;
  }
  const upstream = request({ host: '127.0.0.1', port: 8790, path: req.url, headers: forwarded });
  upstream.on('upgrade', (response, remote, remoteHead) => {
    const lines = Object.entries(response.headers).map(([key, value]) => `${key}: ${value}`);
    socket.write(`HTTP/1.1 101 Switching Protocols\r\n${lines.join('\r\n')}\r\n\r\n`);
    if (remoteHead.length) socket.write(remoteHead);
    if (head.length) remote.write(head);
    socket.pipe(remote).pipe(socket);
    socket.on('error', () => remote.destroy());
    remote.on('error', () => socket.destroy());
    socket.on('close', () => remote.destroy());
    remote.on('close', () => socket.destroy());
  });
  upstream.on('response', (response) => {
    socket.end(`HTTP/1.1 ${response.statusCode} Rejected\r\nConnection: close\r\n\r\n`);
    response.resume();
  });
  upstream.on('error', () => socket.destroy());
  upstream.end();
});
server.listen(18890, '127.0.0.1');
