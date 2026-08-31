import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';

const args = new Map();
for (let index = 2; index < process.argv.length; index += 2)
  args.set(process.argv[index], process.argv[index + 1]);

const tokenFile = args.get('--token-file');
const roomId = args.get('--room');
const port = Number(args.get('--port') ?? '9327');
if (!tokenFile || !roomId || !/^[A-Z0-9]{12}$/.test(roomId)) process.exit(2);

const session = JSON.parse(await readFile(tokenFile, 'utf8'));
const authToken = session.accessToken;
if (typeof authToken !== 'string' || authToken.length < 32) process.exit(2);

const status = {
  phase: 'waiting-for-browser',
  roomId,
  joined: false,
  connected: false,
  remoteAudioTracks: 0,
  connectionType: 'unknown',
  localCandidateType: 'unknown',
  remoteCandidateType: 'unknown',
  protocol: 'unknown',
  error: null,
  updatedAt: new Date().toISOString(),
};

const escapeJsonForHtml = (value) =>
  JSON.stringify(value).replaceAll('<', '\\u003c').replaceAll('>', '\\u003e');

const page = `<!doctype html>
<meta charset="utf-8">
<title>FreeTalk production WebRTC verifier</title>
<body><pre id="state">starting</pre><script>
const config = ${escapeJsonForHtml({
  authToken,
  roomId,
  signalingUrl: 'wss://freetalk.191-44-38-60.sslip.io/ws',
})};
const state = { phase: 'starting', joined: false, connected: false, remoteAudioTracks: 0,
  connectionType: 'unknown', localCandidateType: 'unknown', remoteCandidateType: 'unknown',
  protocol: 'unknown', error: null };
const publish = async (patch = {}) => {
  Object.assign(state, patch);
  document.querySelector('#state').textContent = JSON.stringify(state, null, 2);
  await fetch('/event', { method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify(state) }).catch(() => undefined);
};
const clientId = crypto.randomUUID();
const pendingCandidates = [];
let peer;
let iceServers = [];
let heartbeat;
const socket = new WebSocket(config.signalingUrl + '?room=' + encodeURIComponent(config.roomId)
  + '&cid=' + crypto.randomUUID());
const send = (message) => socket.send(JSON.stringify(message));

const candidateType = (candidate) => {
  const match = / typ (host|srflx|prflx|relay)(?: |$)/.exec(candidate ?? '');
  return match?.[1] ?? 'unknown';
};

const inspectStats = async () => {
  if (!peer) return;
  const reports = await peer.getStats();
  let pair;
  for (const report of reports.values()) {
    if (report.type === 'transport' && report.selectedCandidatePairId)
      pair = reports.get(report.selectedCandidatePairId);
    if (!pair && report.type === 'candidate-pair' && report.state === 'succeeded' && report.nominated)
      pair = report;
  }
  if (!pair) return;
  const local = reports.get(pair.localCandidateId);
  const remote = reports.get(pair.remoteCandidateId);
  const localType = local?.candidateType ?? 'unknown';
  const remoteType = remote?.candidateType ?? 'unknown';
  await publish({
    connected: peer.connectionState === 'connected',
    connectionType: localType === 'relay' || remoteType === 'relay' ? 'turn' : 'direct',
    localCandidateType: localType,
    remoteCandidateType: remoteType,
    protocol: local?.protocol ?? remote?.protocol ?? 'unknown',
    phase: 'stats-ready',
  });
};

const ensurePeer = () => {
  if (peer) return peer;
  peer = new RTCPeerConnection({ iceServers, bundlePolicy: 'max-bundle' });
  const context = new AudioContext();
  const oscillator = context.createOscillator();
  const gain = context.createGain();
  const destination = context.createMediaStreamDestination();
  gain.gain.value = 0;
  oscillator.connect(gain).connect(destination);
  oscillator.start();
  const track = destination.stream.getAudioTracks()[0];
  peer.addTrack(track, destination.stream);
  peer.onicecandidate = ({ candidate }) => {
    if (!candidate) return;
    send({ type: 'ice-candidate', to: window.remotePeerId, candidate: {
      candidate: candidate.candidate, sdpMid: candidate.sdpMid,
      sdpMLineIndex: candidate.sdpMLineIndex, usernameFragment: candidate.usernameFragment,
    }});
  };
  peer.ontrack = ({ track }) => {
    if (track.kind === 'audio') publish({ remoteAudioTracks: state.remoteAudioTracks + 1 });
  };
  peer.onconnectionstatechange = () => {
    publish({ phase: 'peer-' + peer.connectionState, connected: peer.connectionState === 'connected' });
    if (peer.connectionState === 'connected') setTimeout(inspectStats, 750);
  };
  return peer;
};

socket.onopen = () => {
  publish({ phase: 'signaling-open' });
  send({ type: 'join-room', roomId: config.roomId, clientId, sessionId: crypto.randomUUID(),
    authToken: config.authToken, name: 'Production verifier' });
  heartbeat = setInterval(() => send({ type: 'ping', timestamp: Date.now() }), 10_000);
};
socket.onmessage = async ({ data }) => {
  const message = JSON.parse(data);
  if (message.type === 'ice-config') iceServers = message.iceServers;
  if (message.type === 'joined-room') {
    await publish({ phase: 'joined-room', joined: true });
    const existing = message.participants.find((participant) => participant.id !== clientId);
    if (existing) window.remotePeerId = existing.id;
  }
  if (message.type === 'participant-joined') window.remotePeerId = message.participant.id;
  if (message.type === 'offer') {
    window.remotePeerId = message.from;
    const connection = ensurePeer();
    await connection.setRemoteDescription(message.description);
    while (pendingCandidates.length) await connection.addIceCandidate(pendingCandidates.shift());
    const answer = await connection.createAnswer();
    await connection.setLocalDescription(answer);
    send({ type: 'answer', to: message.from, description: {
      type: 'answer', sdp: connection.localDescription.sdp,
    }});
    await publish({ phase: 'answer-sent' });
  }
  if (message.type === 'ice-candidate') {
    window.remotePeerId = message.from;
    const connection = ensurePeer();
    if (connection.remoteDescription) await connection.addIceCandidate(message.candidate);
    else pendingCandidates.push(message.candidate);
  }
  if (message.type === 'pong') return;
  if (message.type === 'error') await publish({ phase: 'signaling-error', error: message.code + ': ' + message.message });
};
socket.onerror = () => publish({ phase: 'socket-error', error: 'WebSocket error' });
socket.onclose = ({ code, reason }) => {
  clearInterval(heartbeat);
  publish({ phase: 'socket-closed', connected: false, error: code + ': ' + reason });
};
setInterval(inspectStats, 5_000);
</script></body>`;

const server = createServer((request, response) => {
  if (request.method === 'GET' && request.url === '/') {
    response.writeHead(200, {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'no-store',
      'content-security-policy':
        "default-src 'self'; connect-src 'self' wss://freetalk.191-44-38-60.sslip.io; script-src 'unsafe-inline'",
    });
    response.end(page);
    return;
  }
  if (request.method === 'GET' && request.url === '/status') {
    response.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' });
    response.end(JSON.stringify(status));
    return;
  }
  if (request.method === 'POST' && request.url === '/event') {
    let body = '';
    request.setEncoding('utf8');
    request.on('data', (chunk) => {
      if (body.length < 16_384) body += chunk;
    });
    request.on('end', () => {
      try {
        const event = JSON.parse(body);
        for (const key of Object.keys(status)) {
          if (key in event && key !== 'roomId' && key !== 'updatedAt') status[key] = event[key];
        }
        status.updatedAt = new Date().toISOString();
        response.writeHead(204);
        response.end();
      } catch {
        response.writeHead(400);
        response.end();
      }
    });
    return;
  }
  response.writeHead(404);
  response.end();
});

server.listen(port, '127.0.0.1', () =>
  console.log(`FreeTalk verifier ready: http://127.0.0.1:${port}`),
);
