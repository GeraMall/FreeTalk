interface CallMessageLike {
  id: string;
  kind: string;
  metadata?: {
    roomId?: string;
    missed?: boolean;
  };
}

export function extractMessageLinks(text: string) {
  return [...text.matchAll(/https?:\/\/[^\s<>"']+/gi)]
    .map((match) => match[0].replace(/[),.!?:;]+$/g, ''))
    .filter(Boolean);
}

export function collapseDuplicateCallMessages<T extends CallMessageLike>(messages: T[]): T[] {
  const preferredByRoom = new Map<string, T>();
  for (const message of messages) {
    if (message.kind !== 'call' || !message.metadata?.roomId) continue;
    const current = preferredByRoom.get(message.metadata.roomId);
    if (!current || (current.metadata?.missed === true && message.metadata.missed !== true)) {
      preferredByRoom.set(message.metadata.roomId, message);
    }
  }
  return messages.filter(
    (message) =>
      message.kind !== 'call' ||
      !message.metadata?.roomId ||
      preferredByRoom.get(message.metadata.roomId)?.id === message.id,
  );
}
