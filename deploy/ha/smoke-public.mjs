import { createRequire } from 'node:module';
const require = createRequire('/opt/freetalk/api/package.json');
const WebSocket = require('ws');
for (const host of ['freetalk.185-225-201-129.sslip.io', 'freetalk.191-44-38-60.sslip.io']) {
  for (const [path, service] of [
    ['/api/health', 'freetalk-api'],
    ['/health', 'freetalk-signaling'],
  ]) {
    const response = await fetch(`https://${host}${path}`, { signal: AbortSignal.timeout(10000) });
    if (!response.ok || response.headers.get('x-trlka-node') !== 'moscow')
      throw new Error('Primary routing failed');
    const data = await response.json();
    if (!data.ok || data.service !== service) throw new Error('Unexpected health response');
  }
  const privateResponse = await fetch(`https://${host}/api/v1/internal/active-rooms`, {
    signal: AbortSignal.timeout(10000),
  });
  if (privateResponse.status !== 404) throw new Error('Internal API exposed');
  await new Promise((resolve, reject) => {
    const ws = new WebSocket(`wss://${host}/ws`, { handshakeTimeout: 10000 });
    const timer = setTimeout(() => {
      ws.terminate();
      reject(new Error('WSS pong timeout'));
    }, 12000);
    const timestamp = Date.now();
    ws.on('open', () => ws.send(JSON.stringify({ type: 'ping', timestamp })));
    ws.on('message', (raw) => {
      const data = JSON.parse(raw.toString());
      if (data.type === 'pong' && data.timestamp === timestamp) {
        clearTimeout(timer);
        ws.close(1000);
        resolve();
      }
    });
    ws.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
  });
  console.log(
    JSON.stringify({ host, api: true, signaling: true, wssPong: true, internalBlocked: true }),
  );
}
