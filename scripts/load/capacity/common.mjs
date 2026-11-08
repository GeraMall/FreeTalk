import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';

export const requireApi = createRequire(resolve('apps/api/package.json'));
export const requireSignal = createRequire(resolve('apps/signaling/package.json'));
export const maxUsers = 10_000;

export function requireLab() {
  assert.equal(process.env.TRLKA_CAPACITY_LAB, 'isolated-ci');
  assert.equal(process.env.GITHUB_ACTIONS, 'true');
  const url = new URL(process.env.DATABASE_URL);
  assert.equal(url.hostname, '127.0.0.1');
  assert.equal(url.port, '54329');
  assert.match(url.pathname, /^\/trlka_capacity_[a-f0-9]+$/);
  return url;
}

export function summary(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const at = (p) => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))] ?? null;
  return { count: sorted.length, p50: at(0.5), p95: at(0.95), p99: at(0.99), max: at(1) };
}
