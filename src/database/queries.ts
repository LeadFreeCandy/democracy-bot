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
};

// Compute rankings from pairwise preferences using topological sort
export function computeRankings(userId: string): { movieId: number; title: string }[] {
  const prefs = preferences.getForUser(userId);
  if (prefs.length === 0) return [];

  // Get all movies that user has ranked (appeared in any pairwise comparison)
  const rankedMovieIds = new Set<number>();
  for (const p of prefs) {
    rankedMovieIds.add(p.movie_a_id);
    rankedMovieIds.add(p.movie_b_id);
  }

  // Filter to only unwatched movies
  const unwatchedMovies = movies.getUnwatched();
  const moviesToRank = unwatchedMovies.filter(m => rankedMovieIds.has(m.id));

  if (moviesToRank.length === 0) return [];

  // Build a comparison function from preferences
  const prefMap = new Map<string, number>();
  for (const p of prefs) {
    prefMap.set(`${p.movie_a_id}:${p.movie_b_id}`, p.preference);
  }

  const compare = (a: number, b: number): number => {
    const key1 = `${a}:${b}`;
    const key2 = `${b}:${a}`;
    if (prefMap.has(key1)) return -prefMap.get(key1)!; // Negative because lower = better
    if (prefMap.has(key2)) return prefMap.get(key2)!;
    return 0;
  };

  // Sort movies by preferences
  const sorted = [...moviesToRank].sort((a, b) => compare(a.id, b.id));

  return sorted.map(m => ({ movieId: m.id, title: m.title }));
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
 * Key ranking logic:
 * - If a user hasn't ranked a movie, they prefer all their ranked movies over it
 * - Unranked movies are tied with each other (no preference between them)
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
  const attendeeSet = new Set(attendance.getAttendees(eventDate));

  // Get all preferences (only from attendees)
  const allPrefs = queryAll<PairwisePreference>(
    'SELECT * FROM pairwise_preferences'
  ).filter(p => attendeeSet.has(p.user_id));

  // Build preference lookup: userId -> (movieA, movieB) -> preference
  const userPrefs = new Map<string, Map<string, number>>();
  for (const pref of allPrefs) {
    if (!userPrefs.has(pref.user_id)) {
      userPrefs.set(pref.user_id, new Map());
    }
    const key = `${pref.movie_a_id}:${pref.movie_b_id}`;
    userPrefs.get(pref.user_id)!.set(key, pref.preference);
  }

  // Build set of ranked movies per user (movies that appear in any pairwise comparison)
  const userRankedMovies = new Map<string, Set<number>>();
  for (const pref of allPrefs) {
    if (!userRankedMovies.has(pref.user_id)) {
      userRankedMovies.set(pref.user_id, new Set());
    }
    userRankedMovies.get(pref.user_id)!.add(pref.movie_a_id);
    userRankedMovies.get(pref.user_id)!.add(pref.movie_b_id);
  }

  // Count how many attendees have ranked each movie
  const rankedByCounts = new Map<number, number>();
  for (const movie of unwatchedMovies) {
    let count = 0;
    for (const attendeeId of attendeeSet) {
      const rankedSet = userRankedMovies.get(attendeeId);
      if (rankedSet?.has(movie.id)) {
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

  // Calculate margins for all pairs
  for (let i = 0; i < movieIds.length; i++) {
    for (let j = i + 1; j < movieIds.length; j++) {
      const movieA = movieIds[i];
      const movieB = movieIds[j];

      let votesForA = 0;
      let votesForB = 0;

      // Check each attendee's preference
      for (const attendeeId of attendeeSet) {
        const prefMap = userPrefs.get(attendeeId);
        const rankedSet = userRankedMovies.get(attendeeId);

        const rankedA = rankedSet?.has(movieA) ?? false;
        const rankedB = rankedSet?.has(movieB) ?? false;

        // If user has explicit pairwise preference, use it
        if (prefMap) {
          const keyAB = `${movieA}:${movieB}`;
          const keyBA = `${movieB}:${movieA}`;

          if (prefMap.has(keyAB)) {
            const pref = prefMap.get(keyAB)!;
            if (pref > 0) votesForA++;
            else if (pref < 0) votesForB++;
            continue;
          } else if (prefMap.has(keyBA)) {
            const pref = prefMap.get(keyBA)!;
            if (pref > 0) votesForB++;
            else if (pref < 0) votesForA++;
            continue;
          }
        }

        // No explicit preference - use implicit preference from ranking status
        // If user ranked one movie but not the other, they prefer the ranked one
        if (rankedA && !rankedB) {
          votesForA++;
        } else if (rankedB && !rankedA) {
          votesForB++;
        }
        // If user ranked both (but no explicit preference) or neither, no vote
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
 * If a user ranked movie i but not j, they prefer i over j.
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
  const attendeeSet = new Set(attendance.getAttendees(eventDate));

  // Initialize matrix with zeros
  const matrix: number[][] = Array(n).fill(null).map(() => Array(n).fill(0));

  // Get all preferences (only from attendees)
  const allPrefs = queryAll<PairwisePreference>(
    'SELECT * FROM pairwise_preferences'
  ).filter(p => attendeeSet.has(p.user_id));

  // Build user preference maps
  const userPrefs = new Map<string, Map<string, number>>();
  for (const pref of allPrefs) {
    if (!userPrefs.has(pref.user_id)) {
      userPrefs.set(pref.user_id, new Map());
    }
    const key = `${pref.movie_a_id}:${pref.movie_b_id}`;
    userPrefs.get(pref.user_id)!.set(key, pref.preference);
  }

  // Build set of ranked movies per user
  const userRankedMovies = new Map<string, Set<number>>();
  for (const pref of allPrefs) {
    if (!userRankedMovies.has(pref.user_id)) {
      userRankedMovies.set(pref.user_id, new Set());
    }
    userRankedMovies.get(pref.user_id)!.add(pref.movie_a_id);
    userRankedMovies.get(pref.user_id)!.add(pref.movie_b_id);
  }

  // Fill matrix by checking each pair for each attendee
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      if (i === j) continue;

      const movieA = movieIds[i];
      const movieB = movieIds[j];

      for (const attendeeId of attendeeSet) {
        const prefMap = userPrefs.get(attendeeId);
        const rankedSet = userRankedMovies.get(attendeeId);

        const rankedA = rankedSet?.has(movieA) ?? false;
        const rankedB = rankedSet?.has(movieB) ?? false;

        // Check explicit preference first
        let hasExplicitPref = false;
        if (prefMap) {
          const keyAB = `${movieA}:${movieB}`;
          const keyBA = `${movieB}:${movieA}`;

          if (prefMap.has(keyAB)) {
            const pref = prefMap.get(keyAB)!;
            if (pref > 0) matrix[i][j]++;
            hasExplicitPref = true;
          } else if (prefMap.has(keyBA)) {
            const pref = prefMap.get(keyBA)!;
            if (pref < 0) matrix[i][j]++;
            hasExplicitPref = true;
          }
        }

        // If no explicit preference, use implicit from ranking status
        if (!hasExplicitPref) {
          if (rankedA && !rankedB) {
            matrix[i][j]++;
          }
        }
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
