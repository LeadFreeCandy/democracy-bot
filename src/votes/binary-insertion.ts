import { recordPreference } from './database';
import { VoteSession, deleteVoteSession } from './session';

export type VoteChoice = 'a' | 'b' | 'tie';

export interface VoteComparisonResult {
  done: boolean;
  rankedCount?: number;
}

/**
 * Process a pairwise choice in a vote session.
 * Same binary-insertion logic as src/ranking/binary-insertion.ts but
 * records preferences in the votes database.
 */
export function processVoteChoice(session: VoteSession, choice: VoteChoice): VoteComparisonResult {
  session.comparisonCount++;

  const optionAId = session.optionToInsert;
  const optionBId = session.sortedOptions[session.currentMid];
  const preference = choice === 'a' ? 1 : choice === 'b' ? -1 : 0;
  recordPreference(session.userId, session.voteId, optionAId, optionBId, preference);

  if (choice === 'a') {
    session.high = session.currentMid;
  } else if (choice === 'b') {
    session.low = session.currentMid + 1;
  } else {
    session.high = session.currentMid;
  }

  if (session.low >= session.high) {
    session.sortedOptions.splice(session.low, 0, session.optionToInsert);
    session.optionsRankedThisSession++;

    if (session.pendingOptions.length === 0) {
      const rankedCount = session.optionsRankedThisSession;
      deleteVoteSession(session.userId, session.voteId);
      return { done: true, rankedCount };
    }

    const nextOption = session.pendingOptions.shift()!;
    session.optionToInsert = nextOption;
    session.low = 0;
    session.high = session.sortedOptions.length;
  }

  session.currentMid = Math.floor((session.low + session.high) / 2);

  return { done: false };
}
