import { preferences } from '../database/queries';
import { RankingSession, deleteSession } from './session';

export type Choice = 'a' | 'b' | 'tie';

export interface ComparisonResult {
  done: boolean;
  rankedCount?: number;
}

export function processChoice(session: RankingSession, choice: Choice): ComparisonResult {
  if (session.phase !== 'ranking') {
    return { done: true, rankedCount: 0 };
  }

  session.comparisonCount++;

  // Record the pairwise preference
  const movieAId = session.movieToInsert;
  const movieBId = session.sortedList[session.currentMid];
  const preference = choice === 'a' ? 1 : choice === 'b' ? -1 : 0;
  preferences.record(session.userId, movieAId, movieBId, preference);

  // Update binary search bounds
  if (choice === 'a') {
    session.high = session.currentMid;
  } else if (choice === 'b') {
    session.low = session.currentMid + 1;
  } else {
    session.high = session.currentMid;
  }

  // Check if movie is positioned
  if (session.low >= session.high) {
    session.sortedList.splice(session.low, 0, session.movieToInsert);
    session.moviesRankedThisSession++;

    if (session.pendingMovies.length === 0) {
      const rankedCount = session.moviesRankedThisSession;
      deleteSession(session.userId);
      return { done: true, rankedCount };
    }

    // Move to next movie
    const nextMovie = session.pendingMovies.shift()!;
    session.movieToInsert = nextMovie;
    session.low = 0;
    session.high = session.sortedList.length;
  }

  session.currentMid = Math.floor((session.low + session.high) / 2);

  return { done: false };
}
