import { config } from '../config';
import { responses, preferences } from '../database/queries';

export type SessionPhase = 'ingestion' | 'ranking';

export interface RankingSession {
  userId: string;
  phase: SessionPhase;
  // Ingestion phase
  pendingIngestion: number[];  // Movie IDs to ask Y/N
  currentIngestionMovie: number | null;
  ingestionCount: number;
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

export function createSession(
  userId: string,
  unrespondedMovieIds: number[],
  moviesToRank: { id: number; response: 'yes' | 'no' }[]
): RankingSession | null {
  // If nothing to do, return null
  if (unrespondedMovieIds.length === 0 && moviesToRank.length === 0) {
    return null;
  }

  const session: RankingSession = {
    userId,
    phase: 'ingestion',
    // Ingestion
    pendingIngestion: [...unrespondedMovieIds],
    currentIngestionMovie: unrespondedMovieIds[0] ?? null,
    ingestionCount: 0,
    // Ranking (will be set up after ingestion)
    movieToInsert: 0,
    sortedList: [],
    pendingMovies: [],
    low: 0,
    high: 0,
    currentMid: 0,
    comparisonCount: 0,
    moviesRankedThisSession: 0,
    // Metadata
    createdAt: Date.now(),
  };

  // If no ingestion needed, skip to ranking
  if (unrespondedMovieIds.length === 0) {
    setupRankingPhase(session, moviesToRank);
  }

  sessions.set(userId, session);
  return session;
}

function setupRankingPhase(
  session: RankingSession,
  moviesToRank: { id: number; response: 'yes' | 'no' }[]
): void {
  session.phase = 'ranking';

  // Filter out 'no' responses - only 'yes' movies get ranked
  const rankableMovies = moviesToRank.filter(m => m.response === 'yes').map(m => m.id);

  if (rankableMovies.length === 0) {
    return;
  }

  // Get existing rankings from pairwise preferences
  const existingRanked = getExistingRankedOrder(session.userId, rankableMovies);

  // Movies not yet in the ranked list
  const rankedSet = new Set(existingRanked);
  const unrankedMovies = rankableMovies.filter(id => !rankedSet.has(id));

  session.sortedList = existingRanked;
  session.pendingMovies = unrankedMovies;

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
  }
}

function getExistingRankedOrder(userId: string, movieIds: number[]): number[] {
  const prefs = preferences.getForUser(userId);
  if (prefs.length === 0) return [];

  // Build preference map
  const prefMap = new Map<string, number>();
  for (const p of prefs) {
    prefMap.set(`${p.movie_a_id}:${p.movie_b_id}`, p.preference);
  }

  // Get movies that have been compared
  const comparedMovies = new Set<number>();
  for (const p of prefs) {
    if (movieIds.includes(p.movie_a_id)) comparedMovies.add(p.movie_a_id);
    if (movieIds.includes(p.movie_b_id)) comparedMovies.add(p.movie_b_id);
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

export function processIngestionResponse(
  session: RankingSession,
  response: 'yes' | 'no'
): { done: boolean; startRanking: boolean } {
  if (session.phase !== 'ingestion' || session.currentIngestionMovie === null) {
    return { done: true, startRanking: false };
  }

  // Save response
  responses.set(session.userId, session.currentIngestionMovie, response);
  session.ingestionCount++;

  // Remove from pending and get next
  session.pendingIngestion.shift();

  if (session.pendingIngestion.length === 0) {
    // Ingestion done, check if we need to rank
    const moviesToRank = responses.getMoviesToRank(session.userId);
    const moviesWithResponses = moviesToRank.map(m => ({
      id: m.id,
      response: responses.getResponse(session.userId, m.id)!,
    }));

    if (moviesWithResponses.length === 0) {
      sessions.delete(session.userId);
      return { done: true, startRanking: false };
    }

    setupRankingPhase(session, moviesWithResponses);

    // Check if there's actually ranking to do
    // No movie to insert means nothing to rank (all movies already ranked or none to rank)
    if (session.pendingMovies.length === 0 && session.movieToInsert === 0) {
      sessions.delete(session.userId);
      return { done: true, startRanking: false };
    }

    return { done: false, startRanking: true };
  }

  session.currentIngestionMovie = session.pendingIngestion[0];
  return { done: false, startRanking: false };
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
