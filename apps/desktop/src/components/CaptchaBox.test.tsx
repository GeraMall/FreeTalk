// @vitest-environment jsdom

import { cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { CaptchaBox } from './CaptchaBox';

afterEach(() => {
  cleanup();
  document
    .querySelectorAll('script[src*="challenges.cloudflare.com"]')
    .forEach((node) => node.remove());
  delete window.turnstile;
  vi.unstubAllEnvs();
});

it('retries loading the challenge after a transient network error', async () => {
  vi.stubEnv('VITE_TURNSTILE_SITE_KEY', 'test-key');
  const onToken = vi.fn();
  const view = render(<CaptchaBox onToken={onToken} />);
  const first = document.querySelector<HTMLScriptElement>(
    'script[src*="challenges.cloudflare.com"]',
  )!;
  fireEvent.error(first);
  fireEvent.click(await view.findByRole('button'));
  const second = document.querySelector<HTMLScriptElement>(
    'script[src*="challenges.cloudflare.com"]',
  )!;
  expect(second).not.toBe(first);
  const renderWidget = vi.fn(() => 'widget');
  window.turnstile = { render: renderWidget, remove: vi.fn() };
  fireEvent.load(second);
  await waitFor(() => expect(renderWidget).toHaveBeenCalledTimes(1));
  expect(onToken).toHaveBeenCalledWith('');
});
