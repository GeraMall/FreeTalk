export type ChatMemberRole = 'owner' | 'admin' | 'member';

export function canPinChatMessage(chatType: 'direct' | 'group', role: ChatMemberRole) {
  return chatType === 'direct' || role === 'owner' || role === 'admin';
}

export function canDeleteChatMessage(input: {
  actorId: string;
  senderId: string | null;
  kind: string;
  chatType: 'direct' | 'group';
  role: ChatMemberRole;
}) {
  if (input.kind === 'system') return false;
  if (input.senderId === input.actorId) return true;
  return input.chatType === 'group' && (input.role === 'owner' || input.role === 'admin');
}
