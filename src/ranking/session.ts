import { config } from '../config';
import { movies, preferences } from '../database/queries';

export interface RankingSession {
  userId: string;
  // Ranking phase
  movieToInsert: number;
  sortedList: number[];        // Already-ranked movie IDs
  pendingMovies: number[];     // Movies yet to rank
  low: number;
  high: number;
  currentMid: number;
  comparisonCount: number;
  moviesRankedThisSession: number;
  // Session metadata
  messageId?: string;
  channelId?: string;
  createdAt: number;
}

const sessions = new Map<string, RankingSession>();

export function createSession(userId: string): RankingSession | null {
  // Get all unwatched movies
  const unwatchedMovies = movies.getUnwatched();
  if (unwatchedMovies.length === 0) {
    return null;
  }

  const movieIds = unwatchedMovies.map(m => m.id);

  // Get existing rankings from pairwise preferences
  const existingRanked = getExistingRankedOrder(userId, movieIds);

  // Movies not yet in the ranked list
  const rankedSet = new Set(existingRanked);
  const unrankedMovies = movieIds.filter(id => !rankedSet.has(id));

  // If all movies are already ranked, nothing to do
  if (unrankedMovies.length === 0) {
    return null;
  }

  const session: RankingSession = {
    userId,
    movieToInsert: 0,
    sortedList: existingRanked,
    pendingMovies: unrankedMovies,
    low: 0,
    high: 0,
    currentMid: 0,
    comparisonCount: 0,
    moviesRankedThisSession: 0,
    createdAt: Date.now(),
  };

  // When sortedList is empty, first movie goes directly in (nothing to compare against)
  if (session.sortedList.length === 0 && session.pendingMovies.length > 0) {
    const firstMovie = session.pendingMovies.shift()!;
    session.sortedList = [firstMovie];
    session.moviesRankedThisSession = 1;
  }

  // Set up comparison for the next movie
  if (session.pendingMovies.length > 0) {
    const nextMovie = session.pendingMovies.shift()!;
    session.movieToInsert = nextMovie;
    session.low = 0;
    session.high = session.sortedList.length;
    session.currentMid = Math.floor((session.low + session.high) / 2);
  } else {
    // All movies processed (only one movie to rank, already added)
    sessions.set(userId, session);
    return session;
  }

  sessions.set(userId, session);
  return session;
}

function getExistingRankedOrder(userId: string, movieIds: number[]): number[] {
  const prefs = preferences.getForUser(userId);
  if (prefs.length === 0) return [];

  // Build preference map
  const prefMap = new Map<string, number>();
  for (const p of prefs) {
    prefMap.set(`${p.movie_a_id}:${p.movie_b_id}`, p.preference);
  }

  // Get movies that have been compared (and are in the current movieIds list)
  const movieIdSet = new Set(movieIds);
  const comparedMovies = new Set<number>();
  for (const p of prefs) {
    if (movieIdSet.has(p.movie_a_id)) comparedMovies.add(p.movie_a_id);
    if (movieIdSet.has(p.movie_b_id)) comparedMovies.add(p.movie_b_id);
  }

  const compare = (a: number, b: number): number => {
    const key1 = `${a}:${b}`;
    const key2 = `${b}:${a}`;
    if (prefMap.has(key1)) return -prefMap.get(key1)!;
    if (prefMap.has(key2)) return prefMap.get(key2)!;
    return 0;
  };

  return [...comparedMovies].sort(compare);
}

export function getSession(userId: string): RankingSession | undefined {
  const session = sessions.get(userId);

  if (session && Date.now() - session.createdAt > config.ranking.sessionTimeoutMs) {
    sessions.delete(userId);
    return undefined;
  }

  return session;
}

export function deleteSession(userId: string): void {
  sessions.delete(userId);
}

export function setSessionMessage(userId: string, messageId: string, channelId: string): void {
  const session = sessions.get(userId);
  if (session) {
    session.messageId = messageId;
    session.channelId = channelId;
  }
}

export function cleanupExpiredSessions(): void {
  const now = Date.now();
  for (const [userId, session] of sessions) {
    if (now - session.createdAt > config.ranking.sessionTimeoutMs) {
      sessions.delete(userId);
    }
  }
}
