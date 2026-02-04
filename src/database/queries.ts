import type { BindParams } from 'sql.js';
import { getDb, saveDatabase } from './index';

export interface Movie {
  id: number;
  title: string;
  submitted_by: string;
  created_at: number;
  updated_at: number;
  watched: number;
  watched_at: number | null;
}

export interface PairwisePreference {
  user_id: string;
  movie_a_id: number;
  movie_b_id: number;
  preference: number;
  created_at: number;
  updated_at: number;
}

export interface ControlPanelData {
  message_id: string;
  channel_id: string;
}

export interface AttendancePanelData {
  message_id: string;
  channel_id: string;
  event_date: string;
}

export interface Attendance {
  user_id: string;
  event_date: string;
  attending: number;
  created_at: number;
  updated_at: number;
}

function queryOne<T>(sql: string, params: BindParams = []): T | undefined {
  const db = getDb();
  const stmt = db.prepare(sql);
  stmt.bind(params);
  if (stmt.step()) {
    const row = stmt.getAsObject() as T;
    stmt.free();
    return row;
  }
  stmt.free();
  return undefined;
}

function queryAll<T>(sql: string, params: BindParams = []): T[] {
  const db = getDb();
  const stmt = db.prepare(sql);
  stmt.bind(params);
  const results: T[] = [];
  while (stmt.step()) {
    results.push(stmt.getAsObject() as T);
  }
  stmt.free();
  return results;
}

function execute(sql: string, params: BindParams = []): { lastInsertRowid: number; changes: number } {
  const db = getDb();
  db.run(sql, params);
  const lastId = queryOne<{ id: number }>('SELECT last_insert_rowid() as id');
  const changes = queryOne<{ changes: number }>('SELECT changes() as changes');
  saveDatabase();
  return {
    lastInsertRowid: lastId?.id ?? 0,
    changes: changes?.changes ?? 0,
  };
}

// Movie queries
export const movies = {
  add(title: string, submittedBy: string): number {
    const now = Date.now();
    const result = execute(
      'INSERT INTO movies (title, submitted_by, created_at, updated_at) VALUES (?, ?, ?, ?)',
      [title, submittedBy, now, now]
    );
    return result.lastInsertRowid;
  },

  getByTitle(title: string): Movie | undefined {
    return queryOne<Movie>('SELECT * FROM movies WHERE title = ? COLLATE NOCASE', [title]);
  },

  getById(id: number): Movie | undefined {
    return queryOne<Movie>('SELECT * FROM movies WHERE id = ?', [id]);
  },

  getUnwatched(): Movie[] {
    return queryAll<Movie>('SELECT * FROM movies WHERE watched = 0 ORDER BY created_at ASC');
  },

  getUnwatchedCount(): number {
    const result = queryOne<{ count: number }>('SELECT COUNT(*) as count FROM movies WHERE watched = 0');
    return result?.count ?? 0;
  },

  markWatched(id: number): void {
    const now = Date.now();
    execute('UPDATE movies SET watched = 1, watched_at = ?, updated_at = ? WHERE id = ?', [now, now, id]);
  },
};

// Pairwise preference queries
export const preferences = {
  record(userId: string, movieAId: number, movieBId: number, preference: number): void {
    const now = Date.now();
    execute(
      `INSERT INTO pairwise_preferences (user_id, movie_a_id, movie_b_id, preference, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(user_id, movie_a_id, movie_b_id) DO UPDATE SET preference = ?, updated_at = ?`,
      [userId, movieAId, movieBId, preference, now, now, preference, now]
    );
  },

  getForUser(userId: string): PairwisePreference[] {
    return queryAll<PairwisePreference>(
      'SELECT * FROM pairwise_preferences WHERE user_id = ? ORDER BY updated_at DESC',
      [userId]
    );
  },

  getPreference(userId: string, movieAId: number, movieBId: number): number | undefined {
    // Check both orderings
    let result = queryOne<{ preference: number }>(
      'SELECT preference FROM pairwise_preferences WHERE user_id = ? AND movie_a_id = ? AND movie_b_id = ?',
      [userId, movieAId, movieBId]
    );
    if (result) return result.preference;

    // Check reverse ordering
    result = queryOne<{ preference: number }>(
      'SELECT preference FROM pairwise_preferences WHERE user_id = ? AND movie_a_id = ? AND movie_b_id = ?',
      [userId, movieBId, movieAId]
    );
    if (result) return -result.preference; // Flip the preference

    return undefined;
  },

  deleteForMovie(userId: string, movieId: number): void {
    execute(
      'DELETE FROM pairwise_preferences WHERE user_id = ? AND (movie_a_id = ? OR movie_b_id = ?)',
      [userId, movieId, movieId]
    );
  },
};

export interface RankedMovie {
  movieId: number;
  title: string;
  rank: number;
}

export interface RankingResult {
  ranked: RankedMovie[];
  unranked: { movieId: number; title: string }[];
}

// Compute rankings from pairwise preferences using topological sort
export function computeRankings(userId: string): RankingResult {
  const prefs = preferences.getForUser(userId);
  if (prefs.length === 0) return { ranked: [], unranked: [] };

  // Get all movies that user has compared (appeared in any pairwise comparison)
  const comparedMovieIds = new Set<number>();
  for (const p of prefs) {
    comparedMovieIds.add(p.movie_a_id);
    comparedMovieIds.add(p.movie_b_id);
  }

  // Filter to only unwatched movies
  const unwatchedMovies = movies.getUnwatched();
  const moviesToRank = unwatchedMovies.filter(m => comparedMovieIds.has(m.id));

  if (moviesToRank.length === 0) return { ranked: [], unranked: [] };

  const movieIds = moviesToRank.map(m => m.id);
  const movieMap = new Map(moviesToRank.map(m => [m.id, m]));

  // Track which pairs have been compared (regardless of preference value)
  const comparedPairs = new Set<string>();
  for (const p of prefs) {
    comparedPairs.add(`${p.movie_a_id}:${p.movie_b_id}`);
    comparedPairs.add(`${p.movie_b_id}:${p.movie_a_id}`);
  }

  // Build directed graph: edge from A to B means A is preferred over B
  const graph = new Map<number, Set<number>>();
  const inDegree = new Map<number, number>();

  for (const id of movieIds) {
    graph.set(id, new Set());
    inDegree.set(id, 0);
  }

  // Add edges based on preferences
  for (const p of prefs) {
    const a = p.movie_a_id;
    const b = p.movie_b_id;

    // Skip if either movie is not in our list (might be watched)
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
  // Movies are connected if they've been compared, regardless of preference value
  const comparisonGraph = new Map<number, Set<number>>();
  for (const id of movieIds) {
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

  // Find connected components using comparison graph (not preference graph)
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
      // Follow comparison edges (undirected)
      for (const neighbor of comparisonGraph.get(node) ?? []) {
        if (!visited.has(neighbor)) stack.push(neighbor);
      }
    }
    return component;
  }

  for (const id of movieIds) {
    if (!visited.has(id)) {
      components.push(dfs(id));
    }
  }

  // Find the largest connected component - this is the "main" ranking
  // Other components go to unranked
  components.sort((a, b) => b.length - a.length);
  const mainComponent = new Set(components[0] ?? []);
  const unrankedIds = movieIds.filter(id => !mainComponent.has(id));

  // Topological sort the main component using Kahn's algorithm
  // Movies at same level share the same rank
  const ranked: RankedMovie[] = [];
  const remaining = new Set(mainComponent);
  let currentRank = 1;

  // Recalculate in-degrees for just the main component
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
      // Cycle detected - add remaining as unranked
      for (const id of remaining) {
        unrankedIds.push(id);
      }
      break;
    }

    // Check which sources are truly tied (have explicit comparison with preference=0)
    // vs which just haven't been compared
    const tiedGroups: number[][] = [];
    const sourcesRemaining = new Set(sources);

    while (sourcesRemaining.size > 0) {
      const first = [...sourcesRemaining][0];
      sourcesRemaining.delete(first);
      const group = [first];

      // Find all sources that are explicitly tied to this one
      for (const other of [...sourcesRemaining]) {
        const key = `${first}:${other}`;
        if (comparedPairs.has(key)) {
          // They were compared - check if tied (no edge means preference was 0)
          const hasEdge = graph.get(first)?.has(other) || graph.get(other)?.has(first);
          if (!hasEdge) {
            group.push(other);
            sourcesRemaining.delete(other);
          }
        }
      }

      tiedGroups.push(group);
    }

    // Sources that weren't compared to each other go to unranked
    // Unless there's only one group, then they can be ranked
    if (tiedGroups.length === 1) {
      // All sources are either explicitly tied or form a single group
      const group = tiedGroups[0];
      group.sort((a, b) => (movieMap.get(a)?.title ?? '').localeCompare(movieMap.get(b)?.title ?? ''));
      for (const id of group) {
        ranked.push({
          movieId: id,
          title: movieMap.get(id)!.title,
          rank: currentRank,
        });
        remaining.delete(id);
        // Decrease in-degree of neighbors
        for (const neighbor of graph.get(id) ?? []) {
          if (remaining.has(neighbor)) {
            componentInDegree.set(neighbor, componentInDegree.get(neighbor)! - 1);
          }
        }
      }
      currentRank++;
    } else {
      // Multiple unconnected groups at same level - they can't be ordered
      // Put them all at the same rank
      for (const group of tiedGroups) {
        group.sort((a, b) => (movieMap.get(a)?.title ?? '').localeCompare(movieMap.get(b)?.title ?? ''));
        for (const id of group) {
          ranked.push({
            movieId: id,
            title: movieMap.get(id)!.title,
            rank: currentRank,
          });
          remaining.delete(id);
          for (const neighbor of graph.get(id) ?? []) {
            if (remaining.has(neighbor)) {
              componentInDegree.set(neighbor, componentInDegree.get(neighbor)! - 1);
            }
          }
        }
      }
      currentRank++;
    }
  }

  // Post-process: merge ranks for explicitly tied movies
  // If A and B have preference = 0 (explicit tie), they should have the same rank
  // Use the better (lower) rank for both
  const explicitTies = new Map<number, Set<number>>();
  for (const p of prefs) {
    if (p.preference === 0) {
      const a = p.movie_a_id;
      const b = p.movie_b_id;
      if (!explicitTies.has(a)) explicitTies.set(a, new Set([a]));
      if (!explicitTies.has(b)) explicitTies.set(b, new Set([b]));
      // Merge the tie groups
      const groupA = explicitTies.get(a)!;
      const groupB = explicitTies.get(b)!;
      const merged = new Set([...groupA, ...groupB]);
      for (const id of merged) {
        explicitTies.set(id, merged);
      }
    }
  }

  // For each tie group, find the best (lowest) rank and assign it to all members
  const processedGroups = new Set<Set<number>>();
  for (const [, tieGroup] of explicitTies) {
    if (processedGroups.has(tieGroup)) continue;
    processedGroups.add(tieGroup);

    // Find best rank among group members
    let bestRank = Infinity;
    for (const id of tieGroup) {
      const r = ranked.find(r => r.movieId === id);
      if (r && r.rank < bestRank) {
        bestRank = r.rank;
      }
    }

    // Assign best rank to all members
    if (bestRank !== Infinity) {
      for (const id of tieGroup) {
        const r = ranked.find(r => r.movieId === id);
        if (r) {
          r.rank = bestRank;
        }
      }
    }
  }

  // Re-sort ranked by rank, then alphabetically
  ranked.sort((a, b) => {
    if (a.rank !== b.rank) return a.rank - b.rank;
    return a.title.localeCompare(b.title);
  });

  const unranked = unrankedIds.map(id => ({
    movieId: id,
    title: movieMap.get(id)!.title,
  }));
  unranked.sort((a, b) => a.title.localeCompare(b.title));

  return { ranked, unranked };
}

// Get unwatched movies that user hasn't ranked yet
export function getUnrankedMovies(userId: string): Movie[] {
  const unwatchedMovies = movies.getUnwatched();
  const prefs = preferences.getForUser(userId);

  // Get set of all movies that have been compared
  const comparedMovies = new Set<number>();
  for (const p of prefs) {
    comparedMovies.add(p.movie_a_id);
    comparedMovies.add(p.movie_b_id);
  }

  // Return movies that haven't been compared yet
  return unwatchedMovies.filter(m => !comparedMovies.has(m.id));
}

// Condorcet election result
export interface CondorcetResult {
  movieId: number;
  title: string;
  rankedByCount: number; // Number of attendees who have ranked this movie
  wins: number;          // Head-to-head wins (from locked pairs)
  losses: number;        // Head-to-head losses (from locked pairs)
  ties: number;          // Head-to-head ties
}

// Edge in ranked pairs graph
interface RankedPair {
  winner: number;  // movie id
  loser: number;   // movie id
  margin: number;  // votes for winner - votes for loser
}

/**
 * Check if adding an edge from 'from' to 'to' would create a cycle.
 * Uses DFS to check if 'to' can reach 'from' via existing locked edges.
 */
function wouldCreateCycle(
  locked: Map<number, Set<number>>,
  from: number,
  to: number
): boolean {
  // If adding from->to, check if to can already reach from
  const visited = new Set<number>();
  const stack = [to];

  while (stack.length > 0) {
    const current = stack.pop()!;
    if (current === from) return true;
    if (visited.has(current)) continue;
    visited.add(current);

    const neighbors = locked.get(current);
    if (neighbors) {
      for (const neighbor of neighbors) {
        stack.push(neighbor);
      }
    }
  }
  return false;
}

/**
 * Compute aggregate movie rankings using Ranked Pairs (Tideman) method.
 * Only counts votes from users who have marked themselves as attending.
 *
 * Uses each user's computed rankings (with transitivity) to determine preferences:
 * - If movie A has a better rank than B → vote for A
 * - If same rank (explicit tie) → no vote
 * - If A is ranked and B is unranked → vote for A
 * - If both unranked → no vote
 *
 * 1. For each pair of movies, compute margin of victory (votes for winner - votes for loser)
 * 2. Sort pairs by margin (strongest victories first)
 * 3. Lock in pairs that don't create cycles
 * 4. Derive ranking from the locked graph (topological sort)
 */
export function computeCondorcetRanking(): CondorcetResult[] {
  const unwatchedMovies = movies.getUnwatched();
  if (unwatchedMovies.length === 0) return [];

  // Get attendees for next Wednesday
  const eventDate = getNextWednesday();
  const attendees = attendance.getAttendees(eventDate);

  if (attendees.length === 0) return [];

  // Compute rankings for each attendee using the topological sort algorithm
  // This handles transitivity and ties properly
  const userRankings = new Map<string, { rankMap: Map<number, number>; unrankedSet: Set<number> }>();

  for (const attendeeId of attendees) {
    const { ranked, unranked } = computeRankings(attendeeId);

    // Build a map from movieId -> rank for quick lookup
    const rankMap = new Map<number, number>();
    for (const r of ranked) {
      rankMap.set(r.movieId, r.rank);
    }

    // Build set of unranked movie IDs
    const unrankedSet = new Set(unranked.map(u => u.movieId));

    userRankings.set(attendeeId, { rankMap, unrankedSet });
  }

  // Count how many attendees have ranked each movie
  const rankedByCounts = new Map<number, number>();
  for (const movie of unwatchedMovies) {
    let count = 0;
    for (const attendeeId of attendees) {
      const userRanking = userRankings.get(attendeeId);
      if (userRanking?.rankMap.has(movie.id)) {
        count++;
      }
    }
    rankedByCounts.set(movie.id, count);
  }

  const movieIds = unwatchedMovies.map(m => m.id);
  const pairs: RankedPair[] = [];
  const tieCount = new Map<number, number>();

  for (const id of movieIds) {
    tieCount.set(id, 0);
  }

  // Calculate margins for all pairs using computed rankings
  for (let i = 0; i < movieIds.length; i++) {
    for (let j = i + 1; j < movieIds.length; j++) {
      const movieA = movieIds[i];
      const movieB = movieIds[j];

      let votesForA = 0;
      let votesForB = 0;

      // Check each attendee's preference based on their computed ranking
      for (const attendeeId of attendees) {
        const userRanking = userRankings.get(attendeeId);
        if (!userRanking) continue;

        const { rankMap } = userRanking;

        const rankA = rankMap.get(movieA);
        const rankB = rankMap.get(movieB);

        if (rankA !== undefined && rankB !== undefined) {
          // Both movies are ranked - compare ranks (lower rank = better)
          if (rankA < rankB) {
            votesForA++;
          } else if (rankB < rankA) {
            votesForB++;
          }
          // If rankA === rankB, it's a tie - no vote
        } else if (rankA !== undefined && rankB === undefined) {
          // A is ranked, B is either unranked or not compared at all
          // Prefer the ranked movie
          votesForA++;
        } else if (rankB !== undefined && rankA === undefined) {
          // B is ranked, A is either unranked or not compared at all
          votesForB++;
        }
        // If both are undefined (neither ranked nor in unranked list), no vote
        // If both are in unranked list, no vote (can't determine preference)
      }

      if (votesForA > votesForB) {
        pairs.push({ winner: movieA, loser: movieB, margin: votesForA - votesForB });
      } else if (votesForB > votesForA) {
        pairs.push({ winner: movieB, loser: movieA, margin: votesForB - votesForA });
      } else {
        // Tie - no edge added
        tieCount.set(movieA, tieCount.get(movieA)! + 1);
        tieCount.set(movieB, tieCount.get(movieB)! + 1);
      }
    }
  }

  // Sort pairs by margin (highest first), then by rankedByCount as tiebreaker
  pairs.sort((a, b) => {
    if (b.margin !== a.margin) return b.margin - a.margin;
    const aRanked = rankedByCounts.get(a.winner) ?? 0;
    const bRanked = rankedByCounts.get(b.winner) ?? 0;
    return bRanked - aRanked;
  });

  // Lock in pairs that don't create cycles
  const locked = new Map<number, Set<number>>();
  for (const id of movieIds) {
    locked.set(id, new Set());
  }

  for (const pair of pairs) {
    if (!wouldCreateCycle(locked, pair.winner, pair.loser)) {
      locked.get(pair.winner)!.add(pair.loser);
    }
  }

  // Count wins/losses from locked graph
  const wins = new Map<number, number>();
  const losses = new Map<number, number>();
  for (const id of movieIds) {
    wins.set(id, 0);
    losses.set(id, 0);
  }

  for (const [winner, losers] of locked) {
    wins.set(winner, losers.size);
    for (const loser of losers) {
      losses.set(loser, losses.get(loser)! + 1);
    }
  }

  // Topological sort to get final ranking
  // Movies with no incoming edges (losses from locked pairs) rank higher
  const inDegree = new Map<number, number>();
  for (const id of movieIds) {
    inDegree.set(id, 0);
  }
  for (const [_winner, losers] of locked) {
    for (const loser of losers) {
      inDegree.set(loser, inDegree.get(loser)! + 1);
    }
  }

  const ranking: number[] = [];
  const remaining = new Set(movieIds);

  while (remaining.size > 0) {
    // Find nodes with in-degree 0
    const sources: number[] = [];
    for (const id of remaining) {
      if (inDegree.get(id) === 0) {
        sources.push(id);
      }
    }

    if (sources.length === 0) {
      // Cycle detected (shouldn't happen with proper cycle detection)
      // Just add remaining in rankedByCount order
      const rest = [...remaining].sort((a, b) => {
        const rA = rankedByCounts.get(a) ?? 0;
        const rB = rankedByCounts.get(b) ?? 0;
        return rB - rA;
      });
      ranking.push(...rest);
      break;
    }

    // Sort sources by rankedByCount (tiebreaker)
    sources.sort((a, b) => {
      const rA = rankedByCounts.get(a) ?? 0;
      const rB = rankedByCounts.get(b) ?? 0;
      if (rB !== rA) return rB - rA;
      // Final tiebreaker: alphabetical by title
      const movieA = unwatchedMovies.find(m => m.id === a);
      const movieB = unwatchedMovies.find(m => m.id === b);
      return (movieA?.title ?? '').localeCompare(movieB?.title ?? '');
    });

    // Take first source, add to ranking
    const next = sources[0];
    ranking.push(next);
    remaining.delete(next);

    // Decrease in-degree of neighbors
    const neighbors = locked.get(next);
    if (neighbors) {
      for (const neighbor of neighbors) {
        inDegree.set(neighbor, inDegree.get(neighbor)! - 1);
      }
    }
  }

  // Build results in ranking order
  const results: CondorcetResult[] = ranking.map(id => {
    const movie = unwatchedMovies.find(m => m.id === id)!;
    return {
      movieId: id,
      title: movie.title,
      rankedByCount: rankedByCounts.get(id) ?? 0,
      wins: wins.get(id) ?? 0,
      losses: losses.get(id) ?? 0,
      ties: tieCount.get(id) ?? 0,
    };
  });

  return results;
}

// Control panel queries
export const controlPanel = {
  get(): ControlPanelData | undefined {
    return queryOne<ControlPanelData>(
      'SELECT message_id, channel_id FROM control_panel WHERE id = 1'
    );
  },

  set(messageId: string, channelId: string): void {
    execute(
      'INSERT OR REPLACE INTO control_panel (id, message_id, channel_id) VALUES (1, ?, ?)',
      [messageId, channelId]
    );
  },
};

// Attendance panel queries
export const attendancePanel = {
  get(): AttendancePanelData | undefined {
    return queryOne<AttendancePanelData>(
      'SELECT message_id, channel_id, event_date FROM attendance_panel WHERE id = 1'
    );
  },

  set(messageId: string, channelId: string, eventDate: string): void {
    execute(
      'INSERT OR REPLACE INTO attendance_panel (id, message_id, channel_id, event_date) VALUES (1, ?, ?, ?)',
      [messageId, channelId, eventDate]
    );
  },
};

// Attendance queries
export const attendance = {
  set(userId: string, eventDate: string, attending: boolean): void {
    const now = Date.now();
    execute(
      `INSERT INTO attendance (user_id, event_date, attending, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(user_id, event_date) DO UPDATE SET attending = ?, updated_at = ?`,
      [userId, eventDate, attending ? 1 : 0, now, now, attending ? 1 : 0, now]
    );
  },

  get(userId: string, eventDate: string): boolean | undefined {
    const result = queryOne<{ attending: number }>(
      'SELECT attending FROM attendance WHERE user_id = ? AND event_date = ?',
      [userId, eventDate]
    );
    return result ? result.attending === 1 : undefined;
  },

  getAttendees(eventDate: string): string[] {
    const results = queryAll<{ user_id: string }>(
      'SELECT user_id FROM attendance WHERE event_date = ? AND attending = 1 ORDER BY created_at ASC',
      [eventDate]
    );
    return results.map(r => r.user_id);
  },

  clearForDate(eventDate: string): void {
    execute('DELETE FROM attendance WHERE event_date = ?', [eventDate]);
  },
};

/**
 * Get the next Wednesday date in YYYY-MM-DD format.
 */
export function getNextWednesday(): string {
  const now = new Date();
  const dayOfWeek = now.getDay(); // 0 = Sunday, 3 = Wednesday
  let daysUntilWednesday = (3 - dayOfWeek + 7) % 7;
  // If today is Wednesday, keep it as today
  if (daysUntilWednesday === 0) {
    daysUntilWednesday = 0;
  }
  const nextWed = new Date(now.getFullYear(), now.getMonth(), now.getDate() + daysUntilWednesday);
  return nextWed.toISOString().split('T')[0];
}

/**
 * Format a date string (YYYY-MM-DD) as a readable date.
 */
export function formatEventDate(dateStr: string): string {
  const [year, month, day] = dateStr.split('-').map(Number);
  const date = new Date(year, month - 1, day); // month is 0-indexed
  return date.toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  });
}

// Users queries
export const users = {
  getWithUnrankedMovies(): string[] {
    // Get users who have ranked at least one movie but have unranked movies
    const prefs = queryAll<{ user_id: string }>('SELECT DISTINCT user_id FROM pairwise_preferences');
    const unwatchedMovies = movies.getUnwatched();
    const unwatchedIds = new Set(unwatchedMovies.map(m => m.id));

    const usersWithUnranked: string[] = [];
    for (const { user_id } of prefs) {
      // Get movies this user has ranked
      const userPrefs = queryAll<{ movie_a_id: number; movie_b_id: number }>(
        'SELECT movie_a_id, movie_b_id FROM pairwise_preferences WHERE user_id = ?',
        [user_id]
      );
      const rankedIds = new Set<number>();
      for (const p of userPrefs) {
        if (unwatchedIds.has(p.movie_a_id)) rankedIds.add(p.movie_a_id);
        if (unwatchedIds.has(p.movie_b_id)) rankedIds.add(p.movie_b_id);
      }

      // Check if there are unwatched movies they haven't ranked
      if (rankedIds.size < unwatchedIds.size) {
        usersWithUnranked.push(user_id);
      }
    }
    return usersWithUnranked;
  },
};

// Database dump
export interface CondorcetMatrix {
  movies: string[];  // Movie titles in order
  matrix: number[][]; // matrix[i][j] = votes for movie i over movie j
  asciiTable: string; // Pretty-printed ASCII table
}

export interface DatabaseDump {
  movies: Movie[];
  pairwise_preferences: PairwisePreference[];
  condorcet_matrix: CondorcetMatrix;
}

/**
 * Format the Condorcet matrix as a pretty ASCII table.
 */
function formatCondorcetAsciiTable(titles: string[], matrix: number[][]): string {
  if (titles.length === 0) return 'No movies in queue.';

  const n = titles.length;

  // Truncate titles for display (max 12 chars)
  const maxTitleLen = 12;
  const shortTitles = titles.map(t =>
    t.length > maxTitleLen ? t.slice(0, maxTitleLen - 1) + '.' : t
  );

  // Column width: max of title length and cell content width
  const colWidth = Math.max(...shortTitles.map(t => t.length), 3) + 1;

  // Row label width (for left column)
  const rowLabelWidth = colWidth;

  // Build header row
  let table = ' '.repeat(rowLabelWidth) + '|';
  for (let j = 0; j < n; j++) {
    table += shortTitles[j].padStart(colWidth) + ' ';
  }
  table += '\n';

  // Separator line
  table += '-'.repeat(rowLabelWidth) + '+' + '-'.repeat((colWidth + 1) * n) + '\n';

  // Data rows
  for (let i = 0; i < n; i++) {
    table += shortTitles[i].padStart(rowLabelWidth) + '|';
    for (let j = 0; j < n; j++) {
      if (i === j) {
        table += '-'.padStart(colWidth) + ' ';
      } else {
        table += matrix[i][j].toString().padStart(colWidth) + ' ';
      }
    }
    table += '\n';
  }

  // Add legend
  table += '\nRow = candidate, Column = opponent';
  table += '\nCell value = votes for row movie over column movie';

  return table;
}

/**
 * Compute the Condorcet pairwise comparison matrix.
 * matrix[i][j] = number of voters who prefer movie i over movie j
 * Only counts votes from attendees.
 * Uses each user's computed rankings (with transitivity) to determine preferences.
 */
export function computeCondorcetMatrix(): CondorcetMatrix {
  const unwatchedMovies = movies.getUnwatched();
  if (unwatchedMovies.length === 0) {
    return { movies: [], matrix: [], asciiTable: 'No movies in queue.' };
  }

  const movieTitles = unwatchedMovies.map(m => m.title);
  const movieIds = unwatchedMovies.map(m => m.id);
  const n = movieIds.length;

  // Get attendees for next Wednesday
  const eventDate = getNextWednesday();
  const attendees = attendance.getAttendees(eventDate);

  // Initialize matrix with zeros
  const matrix: number[][] = Array(n).fill(null).map(() => Array(n).fill(0));

  if (attendees.length === 0) {
    const asciiTable = formatCondorcetAsciiTable(movieTitles, matrix);
    return { movies: movieTitles, matrix, asciiTable };
  }

  // Compute rankings for each attendee using the topological sort algorithm
  const userRankings = new Map<string, Map<number, number>>();

  for (const attendeeId of attendees) {
    const { ranked } = computeRankings(attendeeId);

    // Build a map from movieId -> rank for quick lookup
    const rankMap = new Map<number, number>();
    for (const r of ranked) {
      rankMap.set(r.movieId, r.rank);
    }

    userRankings.set(attendeeId, rankMap);
  }

  // Fill matrix by checking each pair for each attendee
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      if (i === j) continue;

      const movieA = movieIds[i];
      const movieB = movieIds[j];

      for (const attendeeId of attendees) {
        const rankMap = userRankings.get(attendeeId);
        if (!rankMap) continue;

        const rankA = rankMap.get(movieA);
        const rankB = rankMap.get(movieB);

        if (rankA !== undefined && rankB !== undefined) {
          // Both movies are ranked - compare ranks (lower rank = better)
          if (rankA < rankB) {
            matrix[i][j]++;
          }
          // If rankA === rankB (tie) or rankA > rankB, no vote for A over B
        } else if (rankA !== undefined && rankB === undefined) {
          // A is ranked, B is not - prefer A
          matrix[i][j]++;
        }
        // If both undefined or only B ranked, no vote for A over B
      }
    }
  }

  const asciiTable = formatCondorcetAsciiTable(movieTitles, matrix);

  return { movies: movieTitles, matrix, asciiTable };
}

export function dumpDatabase(): DatabaseDump {
  return {
    movies: queryAll<Movie>('SELECT * FROM movies ORDER BY id'),
    pairwise_preferences: queryAll<PairwisePreference>(
      'SELECT * FROM pairwise_preferences ORDER BY user_id, movie_a_id, movie_b_id'
    ),
    condorcet_matrix: computeCondorcetMatrix(),
  };
}

export interface FunFacts {
  topRankedMovie: { title: string; wins: number; losses: number } | null;
  mostUniversallyLoved: { title: string; supportRatio: number; votesFor: number; votesAgainst: number } | null;
  mostControversial: { title: string; controversy: number; votesFor: number; votesAgainst: number } | null;
  condorcetWinner: { title: string } | null;
  mostLopsidedMatchup: { movieA: string; movieB: string; votesFor: number; votesAgainst: number } | null;
  closestMatchup: { movieA: string; movieB: string; votesFor: number; votesAgainst: number; margin: number } | null;
  mostActiveVoter: { oderId: string; comparisons: number } | null;
  totalStats: { movies: number; comparisons: number; voters: number; attendees: number };
  moviesBySubmitter: { oderId: string; count: number; titles: string[] }[];
}

/**
 * Compute fun facts and interesting statistics about the voting data.
 */
export function computeFunFacts(): FunFacts {
  const unwatchedMovies = movies.getUnwatched();
  const allPrefs = queryAll<PairwisePreference>('SELECT * FROM pairwise_preferences');
  const eventDate = getNextWednesday();
  const attendees = attendance.getAttendees(eventDate);

  // Total stats
  const voterIds = new Set(allPrefs.map(p => p.user_id));
  const totalStats = {
    movies: unwatchedMovies.length,
    comparisons: allPrefs.length,
    voters: voterIds.size,
    attendees: attendees.length,
  };

  // Get the Condorcet ranking for top movie
  const condorcetResults = computeCondorcetRanking();
  const topRankedMovie = condorcetResults.length > 0
    ? { title: condorcetResults[0].title, wins: condorcetResults[0].wins, losses: condorcetResults[0].losses }
    : null;

  // Check for Condorcet winner (beats all others head-to-head)
  const condorcetWinner = condorcetResults.length > 0 && condorcetResults[0].losses === 0 && condorcetResults[0].wins > 0
    ? { title: condorcetResults[0].title }
    : null;

  // Compute the matrix to analyze matchups
  const matrixData = computeCondorcetMatrix();
  const { movies: movieTitles, matrix } = matrixData;
  const n = movieTitles.length;

  // Most universally loved: highest (votesFor - votesAgainst) / total comparisons
  // Most controversial: highest min(votesFor, votesAgainst) (lots of disagreement)
  let mostUniversallyLoved: FunFacts['mostUniversallyLoved'] = null;
  let mostControversial: FunFacts['mostControversial'] = null;
  let bestSupportRatio = -Infinity;
  let highestControversy = -1;

  for (let i = 0; i < n; i++) {
    let votesFor = 0;
    let votesAgainst = 0;
    for (let j = 0; j < n; j++) {
      if (i !== j) {
        votesFor += matrix[i][j];
        votesAgainst += matrix[j][i];
      }
    }
    const totalVotes = votesFor + votesAgainst;
    if (totalVotes > 0) {
      const supportRatio = (votesFor - votesAgainst) / totalVotes;
      if (supportRatio > bestSupportRatio) {
        bestSupportRatio = supportRatio;
        mostUniversallyLoved = { title: movieTitles[i], supportRatio, votesFor, votesAgainst };
      }

      // Controversy = how evenly split the votes are (min of for/against)
      const controversy = Math.min(votesFor, votesAgainst);
      if (controversy > highestControversy) {
        highestControversy = controversy;
        mostControversial = { title: movieTitles[i], controversy, votesFor, votesAgainst };
      }
    }
  }

  // Most lopsided matchup (highest margin) and closest matchup
  let mostLopsidedMatchup: FunFacts['mostLopsidedMatchup'] = null;
  let closestMatchup: FunFacts['closestMatchup'] = null;
  let highestMargin = -1;
  let lowestNonZeroMargin = Infinity;

  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const votesForI = matrix[i][j];
      const votesForJ = matrix[j][i];
      const totalVotes = votesForI + votesForJ;
      if (totalVotes === 0) continue;

      const margin = Math.abs(votesForI - votesForJ);

      if (margin > highestMargin) {
        highestMargin = margin;
        if (votesForI >= votesForJ) {
          mostLopsidedMatchup = { movieA: movieTitles[i], movieB: movieTitles[j], votesFor: votesForI, votesAgainst: votesForJ };
        } else {
          mostLopsidedMatchup = { movieA: movieTitles[j], movieB: movieTitles[i], votesFor: votesForJ, votesAgainst: votesForI };
        }
      }

      if (margin < lowestNonZeroMargin && totalVotes > 0) {
        lowestNonZeroMargin = margin;
        if (votesForI >= votesForJ) {
          closestMatchup = { movieA: movieTitles[i], movieB: movieTitles[j], votesFor: votesForI, votesAgainst: votesForJ, margin };
        } else {
          closestMatchup = { movieA: movieTitles[j], movieB: movieTitles[i], votesFor: votesForJ, votesAgainst: votesForI, margin };
        }
      }
    }
  }

  // Most active voter
  const voterComparisons = new Map<string, number>();
  for (const pref of allPrefs) {
    voterComparisons.set(pref.user_id, (voterComparisons.get(pref.user_id) ?? 0) + 1);
  }
  let mostActiveVoter: FunFacts['mostActiveVoter'] = null;
  let maxComparisons = 0;
  for (const [oderId, count] of voterComparisons) {
    if (count > maxComparisons) {
      maxComparisons = count;
      mostActiveVoter = { oderId, comparisons: count };
    }
  }

  // Movies by submitter
  const submitterMovies = new Map<string, string[]>();
  for (const movie of unwatchedMovies) {
    const existing = submitterMovies.get(movie.submitted_by) ?? [];
    existing.push(movie.title);
    submitterMovies.set(movie.submitted_by, existing);
  }
  const moviesBySubmitter = Array.from(submitterMovies.entries())
    .map(([oderId, titles]) => ({ oderId, count: titles.length, titles }))
    .sort((a, b) => b.count - a.count);

  return {
    topRankedMovie,
    mostUniversallyLoved,
    mostControversial,
    condorcetWinner,
    mostLopsidedMatchup,
    closestMatchup,
    mostActiveVoter,
    totalStats,
    moviesBySubmitter,
  };
}

/**
 * Format fun facts as a readable text report.
 */
export function formatFunFactsReport(): string {
  const facts = computeFunFacts();
  const lines: string[] = [];

  lines.push('='.repeat(50));
  lines.push('           MOVIE NIGHT FUN FACTS');
  lines.push('='.repeat(50));
  lines.push('');

  // Overview stats
  lines.push('OVERVIEW');
  lines.push('-'.repeat(30));
  lines.push(`Movies in queue: ${facts.totalStats.movies}`);
  lines.push(`Total comparisons made: ${facts.totalStats.comparisons}`);
  lines.push(`Unique voters: ${facts.totalStats.voters}`);
  lines.push(`Attendees for next movie night: ${facts.totalStats.attendees}`);
  lines.push('');

  // Top ranked movie
  if (facts.topRankedMovie) {
    lines.push('TOP RANKED MOVIE');
    lines.push('-'.repeat(30));
    lines.push(`"${facts.topRankedMovie.title}"`);
    lines.push(`  Wins: ${facts.topRankedMovie.wins} | Losses: ${facts.topRankedMovie.losses}`);
    if (facts.condorcetWinner) {
      lines.push(`  ** CONDORCET WINNER - Beats all other movies head-to-head! **`);
    }
    lines.push('');
  }

  // Most universally loved
  if (facts.mostUniversallyLoved) {
    lines.push('MOST UNIVERSALLY LOVED');
    lines.push('-'.repeat(30));
    lines.push(`"${facts.mostUniversallyLoved.title}"`);
    lines.push(`  Votes for: ${facts.mostUniversallyLoved.votesFor} | Against: ${facts.mostUniversallyLoved.votesAgainst}`);
    const pct = ((facts.mostUniversallyLoved.supportRatio + 1) / 2 * 100).toFixed(0);
    lines.push(`  Support ratio: ${pct}% positive`);
    lines.push('');
  }

  // Most controversial
  if (facts.mostControversial) {
    lines.push('MOST CONTROVERSIAL');
    lines.push('-'.repeat(30));
    lines.push(`"${facts.mostControversial.title}"`);
    lines.push(`  Votes for: ${facts.mostControversial.votesFor} | Against: ${facts.mostControversial.votesAgainst}`);
    lines.push(`  (People are evenly split on this one!)`);
    lines.push('');
  }

  // Matchups
  if (facts.mostLopsidedMatchup) {
    lines.push('MOST ONE-SIDED MATCHUP');
    lines.push('-'.repeat(30));
    lines.push(`"${facts.mostLopsidedMatchup.movieA}" vs "${facts.mostLopsidedMatchup.movieB}"`);
    lines.push(`  ${facts.mostLopsidedMatchup.votesFor} - ${facts.mostLopsidedMatchup.votesAgainst}`);
    lines.push('');
  }

  if (facts.closestMatchup) {
    lines.push('CLOSEST MATCHUP');
    lines.push('-'.repeat(30));
    lines.push(`"${facts.closestMatchup.movieA}" vs "${facts.closestMatchup.movieB}"`);
    lines.push(`  ${facts.closestMatchup.votesFor} - ${facts.closestMatchup.votesAgainst} (margin: ${facts.closestMatchup.margin})`);
    lines.push('');
  }

  // Most active voter
  if (facts.mostActiveVoter) {
    lines.push('MOST ACTIVE VOTER');
    lines.push('-'.repeat(30));
    lines.push(`User: ${facts.mostActiveVoter.oderId}`);
    lines.push(`  Total comparisons: ${facts.mostActiveVoter.comparisons}`);
    lines.push('');
  }

  // Movies by submitter
  if (facts.moviesBySubmitter.length > 0) {
    lines.push('MOVIES BY SUBMITTER');
    lines.push('-'.repeat(30));
    for (const sub of facts.moviesBySubmitter) {
      lines.push(`${sub.oderId}: ${sub.count} movie(s)`);
      for (const title of sub.titles) {
        lines.push(`  - ${title}`);
      }
    }
    lines.push('');
  }

  lines.push('='.repeat(50));

  return lines.join('\n');
}

// Admin functions
export function deleteMovie(movieId: number): void {
  execute('DELETE FROM pairwise_preferences WHERE movie_a_id = ? OR movie_b_id = ?', [movieId, movieId]);
  execute('DELETE FROM movies WHERE id = ?', [movieId]);
}

export function resetDatabase(): void {
  execute('DELETE FROM pairwise_preferences');
  execute('DELETE FROM movies');
}

export function resetUserData(userId: string): void {
  execute('DELETE FROM pairwise_preferences WHERE user_id = ?', [userId]);
}

// Reminders tracking
export const reminders = {
  wasSent(eventDate: string, reminderType: string): boolean {
    const result = queryOne<{ sent_at: number }>(
      'SELECT sent_at FROM reminders_sent WHERE event_date = ? AND reminder_type = ?',
      [eventDate, reminderType]
    );
    return !!result;
  },

  markSent(eventDate: string, reminderType: string): void {
    const now = Date.now();
    execute(
      'INSERT OR REPLACE INTO reminders_sent (event_date, reminder_type, sent_at) VALUES (?, ?, ?)',
      [eventDate, reminderType, now]
    );
  },

  clearForDate(eventDate: string): void {
    execute('DELETE FROM reminders_sent WHERE event_date = ?', [eventDate]);
  },
};

/**
 * Get users who are attending but haven't ranked all movies yet.
 */
export function getAttendeesWithUnrankedMovies(eventDate: string): string[] {
  const attendees = attendance.getAttendees(eventDate);
  const unwatchedMovies = movies.getUnwatched();
  const unwatchedIds = new Set(unwatchedMovies.map(m => m.id));

  const usersWithUnranked: string[] = [];
  for (const userId of attendees) {
    const userPrefs = queryAll<{ movie_a_id: number; movie_b_id: number }>(
      'SELECT movie_a_id, movie_b_id FROM pairwise_preferences WHERE user_id = ?',
      [userId]
    );
    const rankedIds = new Set<number>();
    for (const p of userPrefs) {
      if (unwatchedIds.has(p.movie_a_id)) rankedIds.add(p.movie_a_id);
      if (unwatchedIds.has(p.movie_b_id)) rankedIds.add(p.movie_b_id);
    }

    // If they haven't ranked all unwatched movies
    if (rankedIds.size < unwatchedIds.size) {
      usersWithUnranked.push(userId);
    }
  }
  return usersWithUnranked;
}

/**
 * Get users who have submitted movies or voted but haven't marked attendance.
 */
export function getUsersWhoShouldMarkAttendance(eventDate: string): string[] {
  // Get all users who have either submitted a movie or voted
  const submitters = queryAll<{ submitted_by: string }>(
    'SELECT DISTINCT submitted_by FROM movies WHERE watched = 0'
  );
  const voters = queryAll<{ user_id: string }>(
    'SELECT DISTINCT user_id FROM pairwise_preferences'
  );

  const activeUsers = new Set<string>();
  for (const s of submitters) activeUsers.add(s.submitted_by);
  for (const v of voters) activeUsers.add(v.user_id);

  // Get users who have already marked attendance (either way)
  const usersWithAttendance = queryAll<{ user_id: string }>(
    'SELECT user_id FROM attendance WHERE event_date = ?',
    [eventDate]
  );
  const markedUsers = new Set(usersWithAttendance.map(u => u.user_id));

  // Return users who are active but haven't marked attendance
  return [...activeUsers].filter(userId => !markedUsers.has(userId));
}
