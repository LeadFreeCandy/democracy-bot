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

  // Get movies that have been compared (and are in the current movieIds list)
  const movieIdSet = new Set(movieIds);
  const comparedMovies: number[] = [];
  for (const p of prefs) {
    if (movieIdSet.has(p.movie_a_id) && !comparedMovies.includes(p.movie_a_id)) {
      comparedMovies.push(p.movie_a_id);
    }
    if (movieIdSet.has(p.movie_b_id) && !comparedMovies.includes(p.movie_b_id)) {
      comparedMovies.push(p.movie_b_id);
    }
  }

  if (comparedMovies.length === 0) return [];

  // Build directed graph: edge from A to B means A is preferred over B
  const graph = new Map<number, Set<number>>();
  const inDegree = new Map<number, number>();

  for (const id of comparedMovies) {
    graph.set(id, new Set());
    inDegree.set(id, 0);
  }

  // Add edges based on preferences
  for (const p of prefs) {
    const a = p.movie_a_id;
    const b = p.movie_b_id;

    // Skip if either movie is not in our list
    if (!graph.has(a) || !graph.has(b)) continue;

    if (p.preference > 0) {
      // A preferred over B: edge A -> B
      if (!graph.get(a)!.has(b)) {
        graph.get(a)!.add(b);
        inDegree.set(b, inDegree.get(b)! + 1);
      }
    } else if (p.preference < 0) {
      // B preferred over A: edge B -> A
      if (!graph.get(b)!.has(a)) {
        graph.get(b)!.add(a);
        inDegree.set(a, inDegree.get(a)! + 1);
      }
    }
    // preference === 0: no edge (explicit tie)
  }

  // Build undirected comparison graph for connectivity (includes ties)
  const comparisonGraph = new Map<number, Set<number>>();
  for (const id of comparedMovies) {
    comparisonGraph.set(id, new Set());
  }
  for (const p of prefs) {
    const a = p.movie_a_id;
    const b = p.movie_b_id;
    if (comparisonGraph.has(a) && comparisonGraph.has(b)) {
      comparisonGraph.get(a)!.add(b);
      comparisonGraph.get(b)!.add(a);
    }
  }

  // Find the largest connected component using comparison graph
  const visited = new Set<number>();
  const components: number[][] = [];

  function dfs(start: number): number[] {
    const component: number[] = [];
    const stack = [start];
    while (stack.length > 0) {
      const node = stack.pop()!;
      if (visited.has(node)) continue;
      visited.add(node);
      component.push(node);
      for (const neighbor of comparisonGraph.get(node) ?? []) {
        if (!visited.has(neighbor)) stack.push(neighbor);
      }
    }
    return component;
  }

  for (const id of comparedMovies) {
    if (!visited.has(id)) {
      components.push(dfs(id));
    }
  }

  // Use the largest component for ranking
  components.sort((a, b) => b.length - a.length);
  const mainComponent = new Set(components[0] ?? []);

  // Topological sort the main component
  const result: number[] = [];
  const remaining = new Set(mainComponent);

  // Recalculate in-degrees for main component
  const componentInDegree = new Map<number, number>();
  for (const id of mainComponent) {
    componentInDegree.set(id, 0);
  }
  for (const [from, tos] of graph) {
    if (!mainComponent.has(from)) continue;
    for (const to of tos) {
      if (mainComponent.has(to)) {
        componentInDegree.set(to, componentInDegree.get(to)! + 1);
      }
    }
  }

  while (remaining.size > 0) {
    // Find all nodes with in-degree 0
    const sources: number[] = [];
    for (const id of remaining) {
      if (componentInDegree.get(id) === 0) {
        sources.push(id);
      }
    }

    if (sources.length === 0) {
      // Cycle - skip remaining
      break;
    }

    // Add all sources at this level (they may be tied)
    // Sort by movie ID for consistency
    sources.sort((a, b) => a - b);

    for (const id of sources) {
      result.push(id);
      remaining.delete(id);
      for (const neighbor of graph.get(id) ?? []) {
        if (remaining.has(neighbor)) {
          componentInDegree.set(neighbor, componentInDegree.get(neighbor)! - 1);
        }
      }
    }
  }

  return result;
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
