process.loadEnvFile('/etc/freetalk/signaling.env');
const response = await fetch('http://127.0.0.1:8787/internal/active-rooms', {
  headers: { 'x-freetalk-internal-secret': process.env.INTERNAL_SIGNALING_SECRET },
  signal: AbortSignal.timeout(5000),
});
if (!response.ok) throw new Error(`Room check failed: HTTP ${response.status}`);
const snapshot = await response.json();
if (!Array.isArray(snapshot.roomIds) || !snapshot.roomIds.every((id) => typeof id === 'string'))
  throw new Error('Invalid room snapshot');
console.log(JSON.stringify({ activeRooms: snapshot.roomIds.length }));
if (process.argv.includes('--require-empty') && snapshot.roomIds.length) process.exit(3);
