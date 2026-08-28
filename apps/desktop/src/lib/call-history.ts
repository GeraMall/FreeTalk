export interface CallHistoryParticipant {
  displayName: string;
  userId?: string | null;
  avatarUrl?: string | null;
}

export function uniqueCallParticipants<T extends CallHistoryParticipant>(participants: T[]): T[] {
  const seenUserIds = new Set<string>();
  const seenNames = new Set<string>();
  return participants.filter((participant) => {
    const userId = participant.userId?.trim();
    const normalizedName = participant.displayName.trim().toLocaleLowerCase('ru-RU');
    if (!normalizedName || (userId && seenUserIds.has(userId)) || seenNames.has(normalizedName))
      return false;
    if (userId) seenUserIds.add(userId);
    seenNames.add(normalizedName);
    return true;
  });
}
