import { config } from '../config';
import {
  getVoteOptions,
  getPreferencesForUser,
  computeVoteRankings,
} from './database';

export interface VoteSession {
  userId: string;
  voteId: number;
  optionToInsert: number;
  sortedOptions: number[];
  pendingOptions: number[];
  low: number;
  high: number;
  currentMid: number;
  comparisonCount: number;
  optionsRankedThisSession: number;
  messageId?: string;
  channelId?: string;
  createdAt: number;
}

// Key: `${userId}:${voteId}`
const sessions = new Map<string, VoteSession>();

function sessionKey(userId: string, voteId: number): string {
  return `${userId}:${voteId}`;
}

/**
 * Create a vote ranking session. Reuses existing preferences to build the
 * sorted list, then queues unranked options for binary-insertion comparison.
 */
export function createVoteSession(userId: string, voteId: number): VoteSession | null {
  const options = getVoteOptions(voteId);
  if (options.length < 2) return null;

  const optionIds = options.map(o => o.id);

  // Get existing ranked order from this user's prior preferences
  const { ranked: existingRanked } = computeVoteRankings(userId, voteId);
  const rankedSet = new Set(existingRanked);
  const unranked = optionIds.filter(id => !rankedSet.has(id));

  if (unranked.length === 0) return null; // all options already ranked

  const session: VoteSession = {
    userId,
    voteId,
    optionToInsert: 0,
    sortedOptions: existingRanked,
    pendingOptions: unranked,
    low: 0,
    high: 0,
    currentMid: 0,
    comparisonCount: 0,
    optionsRankedThisSession: 0,
    createdAt: Date.now(),
  };

  // If sorted list is empty, first option goes in directly
  if (session.sortedOptions.length === 0 && session.pendingOptions.length > 0) {
    const first = session.pendingOptions.shift()!;
    session.sortedOptions = [first];
    session.optionsRankedThisSession = 1;
  }

  // Set up comparison for next option
  if (session.pendingOptions.length > 0) {
    const next = session.pendingOptions.shift()!;
    session.optionToInsert = next;
    session.low = 0;
    session.high = session.sortedOptions.length;
    session.currentMid = Math.floor((session.low + session.high) / 2);
  } else {
    // Only one unranked option, already added — nothing to compare
    const key = sessionKey(userId, voteId);
    sessions.set(key, session);
    return session;
  }

  const key = sessionKey(userId, voteId);
  sessions.set(key, session);
  return session;
}

export function getVoteSession(userId: string, voteId: number): VoteSession | undefined {
  const key = sessionKey(userId, voteId);
  const session = sessions.get(key);

  if (session && Date.now() - session.createdAt > config.ranking.sessionTimeoutMs) {
    sessions.delete(key);
    return undefined;
  }

  return session;
}

export function getAnyVoteSession(userId: string): VoteSession | undefined {
  for (const [key, session] of sessions) {
    if (key.startsWith(`${userId}:`)) {
      if (Date.now() - session.createdAt > config.ranking.sessionTimeoutMs) {
        sessions.delete(key);
        return undefined;
      }
      return session;
    }
  }
  return undefined;
}

export function deleteVoteSession(userId: string, voteId: number): void {
  sessions.delete(sessionKey(userId, voteId));
}

export function setVoteSessionMessage(userId: string, voteId: number, messageId: string, channelId: string): void {
  const session = sessions.get(sessionKey(userId, voteId));
  if (session) {
    session.messageId = messageId;
    session.channelId = channelId;
  }
}

export function cleanupExpiredVoteSessions(): void {
  const now = Date.now();
  for (const [key, session] of sessions) {
    if (now - session.createdAt > config.ranking.sessionTimeoutMs) {
      sessions.delete(key);
    }
  }
}
