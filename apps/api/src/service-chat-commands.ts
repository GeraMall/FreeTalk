export type SupportKind = 'bug' | 'idea';
export function serviceCommand(
  body: string,
  pending?: SupportKind | null,
):
  | { type: 'help' | 'subscription' | 'cancel' | 'unknown' }
  | { type: 'prompt'; kind: SupportKind }
  | { type: 'report'; kind: SupportKind; body: string } {
  const [raw = '', ...parts] = body.trim().split(/\s+/);
  const command = raw.toLowerCase();
  if (command === '/help' || command === '/start') return { type: 'help' };
  if (command === '/subscription') return { type: 'subscription' };
  if (command === '/cancel') return { type: 'cancel' };
  const kind =
    command === '/bug' ? 'bug' : ['/idea', '/feedback'].includes(command) ? 'idea' : undefined;
  if (kind)
    return parts.length
      ? { type: 'report', kind, body: parts.join(' ') }
      : { type: 'prompt', kind };
  if (!command.startsWith('/') && pending)
    return { type: 'report', kind: pending, body: body.trim() };
  return { type: 'unknown' };
}
