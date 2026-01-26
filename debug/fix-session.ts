/**
 * FIXED session logic demonstrating the correct implementation.
 * Run with: npx tsx debug/fix-session.ts
 *
 * This file contains fixes for TWO bug locations:
 * 1. setupRankingPhase() - when sortedList is empty
 * 2. handleIngestionResponse transition - when low >= high (maybe movies)
 */

// ============================================================================
// Types
// ============================================================================

type SessionPhase = 'ingestion' | 'ranking';

interface RankingSession {
  userId: string;
  phase: SessionPhase;
  pendingIngestion: number[];
  currentIngestionMovie: number | null;
  ingestionCount: number;
  movieToInsert: number;
  sortedList: number[];
  pendingMovies: number[];
  low: number;
  high: number;
  currentMid: number;
  comparisonCount: number;
  moviesRankedThisSession: number;
  createdAt: number;
}

// ============================================================================
// Mock Database
// ============================================================================

class MockDatabase {
  movies: { id: number; title: string }[] = [];
  responses: { user_id: string; movie_id: number; response: 'yes' | 'no' | 'maybe' }[] = [];
  preferences: { user_id: string; movie_a_id: number; movie_b_id: number; preference: number }[] = [];

  addMovie(id: number, title: string): void {
    this.movies.push({ id, title });
  }

  addResponse(userId: string, movieId: number, response: 'yes' | 'no' | 'maybe'): void {
    const existing = this.responses.find(r => r.user_id === userId && r.movie_id === movieId);
    if (existing) {
      existing.response = response;
    } else {
      this.responses.push({ user_id: userId, movie_id: movieId, response });
    }
  }

  getUnrespondedMovies(userId: string): { id: number }[] {
    const respondedIds = new Set(
      this.responses.filter(r => r.user_id === userId).map(r => r.movie_id)
    );
    return this.movies.filter(m => !respondedIds.has(m.id));
  }

  getMoviesToRank(userId: string): { id: number }[] {
    const yesOrMaybeIds = new Set(
      this.responses
        .filter(r => r.user_id === userId && r.response !== 'no')
        .map(r => r.movie_id)
    );
    return this.movies.filter(m => yesOrMaybeIds.has(m.id));
  }

  getResponse(userId: string, movieId: number): 'yes' | 'no' | 'maybe' | undefined {
    const r = this.responses.find(r => r.user_id === userId && r.movie_id === movieId);
    return r?.response;
  }

  getPreferencesForUser(userId: string) {
    return this.preferences.filter(p => p.user_id === userId);
  }

  clear(): void {
    this.movies = [];
    this.responses = [];
    this.preferences = [];
  }
}

// ============================================================================
// Helper: Setup next movie for comparison (shared logic)
// ============================================================================

/**
 * Sets up the next movie for comparison. Handles the case where low >= high
 * (position already determined, no comparison needed).
 *
 * Returns true if a comparison is needed, false if ranking is complete.
 */
function setupNextMovieForComparison(
  db: MockDatabase,
  session: RankingSession
): boolean {
  if (session.pendingMovies.length === 0) {
    session.movieToInsert = 0;
    return false; // No more movies to compare
  }

  const nextMovie = session.pendingMovies.shift()!;
  session.movieToInsert = nextMovie;
  session.low = 0;

  const movieResponse = db.getResponse(session.userId, nextMovie);
  if (movieResponse === 'maybe') {
    session.low = session.sortedList.length; // Start from end
  }
  session.high = session.sortedList.length;

  // KEY FIX: When low >= high, position is already determined
  // Insert directly without comparison
  while (session.low >= session.high && session.movieToInsert !== 0) {
    session.sortedList.splice(session.low, 0, session.movieToInsert);
    session.moviesRankedThisSession++;

    if (session.pendingMovies.length === 0) {
      session.movieToInsert = 0;
      return false; // All done
    }

    // Set up the next movie
    const anotherMovie = session.pendingMovies.shift()!;
    session.movieToInsert = anotherMovie;
    session.low = 0;

    const anotherResponse = db.getResponse(session.userId, anotherMovie);
    if (anotherResponse === 'maybe') {
      session.low = session.sortedList.length;
    }
    session.high = session.sortedList.length;
  }

  session.currentMid = Math.floor((session.low + session.high) / 2);
  return session.movieToInsert !== 0;
}

// ============================================================================
// FIXED setupRankingPhase
// ============================================================================

function getExistingRankedOrder(
  db: MockDatabase,
  userId: string,
  movieIds: number[]
): number[] {
  const prefs = db.getPreferencesForUser(userId);
  if (prefs.length === 0) return [];

  const prefMap = new Map<string, number>();
  for (const p of prefs) {
    prefMap.set(`${p.movie_a_id}:${p.movie_b_id}`, p.preference);
  }

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

function setupRankingPhase(
  db: MockDatabase,
  session: RankingSession,
  moviesToRank: { id: number; response: 'yes' | 'no' | 'maybe' }[]
): void {
  session.phase = 'ranking';

  const rankableMovies = moviesToRank.filter(m => m.response !== 'no');

  if (rankableMovies.length === 0) {
    return;
  }

  const yesMovies = rankableMovies.filter(m => m.response === 'yes').map(m => m.id);
  const maybeMovies = rankableMovies.filter(m => m.response === 'maybe').map(m => m.id);

  const existingRanked = getExistingRankedOrder(db, session.userId, [...yesMovies, ...maybeMovies]);

  const rankedSet = new Set(existingRanked);
  const unrankedYes = yesMovies.filter(id => !rankedSet.has(id));
  const unrankedMaybe = maybeMovies.filter(id => !rankedSet.has(id));

  session.sortedList = existingRanked;
  session.pendingMovies = [...unrankedYes, ...unrankedMaybe];

  // =========================================================================
  // FIX 1: When sortedList is empty, first movie goes directly in
  // =========================================================================
  if (session.sortedList.length === 0 && session.pendingMovies.length > 0) {
    const firstMovie = session.pendingMovies.shift()!;
    session.sortedList = [firstMovie];
    session.moviesRankedThisSession = 1;
  }

  // Set up comparison for next movie using shared helper
  setupNextMovieForComparison(db, session);
}

function createSession(
  db: MockDatabase,
  userId: string,
  unrespondedMovieIds: number[],
  moviesToRank: { id: number; response: 'yes' | 'no' | 'maybe' }[]
): RankingSession | null {
  if (unrespondedMovieIds.length === 0 && moviesToRank.length === 0) {
    return null;
  }

  const session: RankingSession = {
    userId,
    phase: 'ingestion',
    pendingIngestion: [...unrespondedMovieIds],
    currentIngestionMovie: unrespondedMovieIds[0] ?? null,
    ingestionCount: 0,
    movieToInsert: 0,
    sortedList: [],
    pendingMovies: [],
    low: 0,
    high: 0,
    currentMid: 0,
    comparisonCount: 0,
    moviesRankedThisSession: 0,
    createdAt: Date.now(),
  };

  if (unrespondedMovieIds.length === 0) {
    setupRankingPhase(db, session, moviesToRank);
  }

  return session;
}

// ============================================================================
// FIXED Ingestion Response Handler
// ============================================================================

function processIngestionResponse(
  db: MockDatabase,
  session: RankingSession,
  response: 'yes' | 'no' | 'maybe'
): { done: boolean; startRanking: boolean } {
  if (session.phase !== 'ingestion' || session.currentIngestionMovie === null) {
    return { done: true, startRanking: false };
  }

  db.addResponse(session.userId, session.currentIngestionMovie, response);
  session.ingestionCount++;
  session.pendingIngestion.shift();

  if (session.pendingIngestion.length === 0) {
    const moviesToRank = db.getMoviesToRank(session.userId);
    const moviesWithResponses = moviesToRank.map(m => ({
      id: m.id,
      response: db.getResponse(session.userId, m.id)!,
    }));

    if (moviesWithResponses.length === 0) {
      return { done: true, startRanking: false };
    }

    setupRankingPhase(db, session, moviesWithResponses);

    if (session.pendingMovies.length === 0 && session.movieToInsert === 0) {
      return { done: true, startRanking: false };
    }

    return { done: false, startRanking: true };
  }

  session.currentIngestionMovie = session.pendingIngestion[0];
  return { done: false, startRanking: false };
}

// FIXED transition logic (for handleIngestionResponse in buttons.ts)
function simulateIngestionToRankingTransition(
  db: MockDatabase,
  session: RankingSession
): { error?: string; completed?: boolean } {
  // Check if there's actually something to rank
  if (session.movieToInsert === 0 || (session.sortedList.length === 0 && session.pendingMovies.length === 0)) {
    return { completed: true };
  }

  // Handle case where there's only one movie to rank
  if (session.sortedList.length === 0 && session.pendingMovies.length === 0 && session.movieToInsert) {
    session.sortedList = [session.movieToInsert];
    session.moviesRankedThisSession = 1;
    return { completed: true };
  }

  // Need at least 2 movies to compare
  if (session.sortedList.length === 0 && session.movieToInsert) {
    session.sortedList = [session.movieToInsert];
    session.moviesRankedThisSession = 1;

    // =========================================================================
    // FIX 2: Use shared helper that handles low >= high case
    // =========================================================================
    const needsComparison = setupNextMovieForComparison(db, session);
    if (!needsComparison) {
      return { completed: true };
    }
  }

  return validateComparisonState(session);
}

// ============================================================================
// Validation
// ============================================================================

function validateComparisonState(session: RankingSession): { error?: string } {
  // No movie to insert means ranking is complete
  if (session.movieToInsert === 0 && session.sortedList.length > 0) {
    return {};
  }

  if (!session.movieToInsert || session.sortedList.length === 0) {
    return {
      error: 'Invalid session state for comparison: no movie to insert or empty sorted list',
    };
  }

  if (session.currentMid < 0 || session.currentMid >= session.sortedList.length) {
    return {
      error: `Invalid currentMid: ${session.currentMid}, sortedList length: ${session.sortedList.length}`,
    };
  }

  return {};
}

// ============================================================================
// Tests
// ============================================================================

function printSession(session: RankingSession | null, label: string): void {
  console.log(`\n--- ${label} ---`);
  if (!session) {
    console.log('  Session: null');
    return;
  }
  console.log(`  phase: ${session.phase}`);
  console.log(`  movieToInsert: ${session.movieToInsert}`);
  console.log(`  sortedList: [${session.sortedList.join(', ')}]`);
  console.log(`  pendingMovies: [${session.pendingMovies.join(', ')}]`);
  console.log(`  moviesRankedThisSession: ${session.moviesRankedThisSession}`);
  console.log(`  low: ${session.low}, high: ${session.high}, currentMid: ${session.currentMid}`);
}

interface TestResult {
  name: string;
  passed: boolean;
  error?: string;
}

const tests: TestResult[] = [];
const db = new MockDatabase();

function runTest(name: string, testFn: () => { error?: string }): void {
  console.log(`\n${'='.repeat(70)}`);
  console.log(`TEST: ${name}`);
  console.log('='.repeat(70));
  try {
    const result = testFn();
    if (result.error) {
      console.log(`\n  ❌ FAILED: ${result.error}`);
      tests.push({ name, passed: false, error: result.error });
    } else {
      console.log(`\n  ✅ PASSED`);
      tests.push({ name, passed: true });
    }
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    console.log(`\n  ❌ EXCEPTION: ${error}`);
    tests.push({ name, passed: false, error });
  }
}

// PATH 1: Direct to ranking
console.log('\n' + '█'.repeat(70));
console.log('PATH 1: DIRECT TO RANKING (FIXED)');
console.log('█'.repeat(70));

runTest('P1-A: Two yes responses, no prior rankings', () => {
  db.clear();
  db.addMovie(1, 'Movie A');
  db.addMovie(2, 'Movie B');
  db.addResponse('user1', 1, 'yes');
  db.addResponse('user1', 2, 'yes');

  const session = createSession(
    db, 'user1',
    db.getUnrespondedMovies('user1').map(m => m.id),
    db.getMoviesToRank('user1').map(m => ({ id: m.id, response: db.getResponse('user1', m.id)! }))
  );

  printSession(session, 'After createSession');
  return validateComparisonState(session!);
});

runTest('P1-B: Single yes response', () => {
  db.clear();
  db.addMovie(1, 'Movie A');
  db.addResponse('user1', 1, 'yes');

  const session = createSession(
    db, 'user1',
    db.getUnrespondedMovies('user1').map(m => m.id),
    db.getMoviesToRank('user1').map(m => ({ id: m.id, response: db.getResponse('user1', m.id)! }))
  );

  printSession(session, 'After createSession');
  // Single movie should be auto-inserted, no comparison needed
  if (session!.movieToInsert === 0 && session!.sortedList.length === 1) {
    return {};
  }
  return validateComparisonState(session!);
});

runTest('P1-C: Yes + Maybe responses', () => {
  db.clear();
  db.addMovie(1, 'Movie A');
  db.addMovie(2, 'Movie B');
  db.addResponse('user1', 1, 'yes');
  db.addResponse('user1', 2, 'maybe');

  const session = createSession(
    db, 'user1',
    db.getUnrespondedMovies('user1').map(m => m.id),
    db.getMoviesToRank('user1').map(m => ({ id: m.id, response: db.getResponse('user1', m.id)! }))
  );

  printSession(session, 'After createSession');
  // Maybe movie at end of 1-element list: auto-inserted
  if (session!.movieToInsert === 0 && session!.sortedList.length === 2) {
    return {};
  }
  return validateComparisonState(session!);
});

runTest('P1-D: Two maybe responses', () => {
  db.clear();
  db.addMovie(1, 'Movie A');
  db.addMovie(2, 'Movie B');
  db.addResponse('user1', 1, 'maybe');
  db.addResponse('user1', 2, 'maybe');

  const session = createSession(
    db, 'user1',
    db.getUnrespondedMovies('user1').map(m => m.id),
    db.getMoviesToRank('user1').map(m => ({ id: m.id, response: db.getResponse('user1', m.id)! }))
  );

  printSession(session, 'After createSession');
  // Both maybe: first auto-inserted, second goes to end (auto-inserted)
  if (session!.movieToInsert === 0 && session!.sortedList.length === 2) {
    return {};
  }
  return validateComparisonState(session!);
});

// PATH 2: Through ingestion
console.log('\n' + '█'.repeat(70));
console.log('PATH 2: INGESTION -> RANKING TRANSITION (FIXED)');
console.log('█'.repeat(70));

runTest('P2-A: Ingest 2 movies as yes', () => {
  db.clear();
  db.addMovie(1, 'Movie A');
  db.addMovie(2, 'Movie B');

  const session = createSession(
    db, 'user1',
    db.getUnrespondedMovies('user1').map(m => m.id),
    db.getMoviesToRank('user1').map(m => ({ id: m.id, response: db.getResponse('user1', m.id)! }))
  );

  processIngestionResponse(db, session!, 'yes');
  const result = processIngestionResponse(db, session!, 'yes');

  if (result.startRanking) {
    const transitionResult = simulateIngestionToRankingTransition(db, session!);
    printSession(session, 'After transition');
    return transitionResult;
  }
  return {};
});

runTest('P2-B: Ingest yes then maybe', () => {
  db.clear();
  db.addMovie(1, 'Movie A');
  db.addMovie(2, 'Movie B');

  const session = createSession(
    db, 'user1',
    db.getUnrespondedMovies('user1').map(m => m.id),
    db.getMoviesToRank('user1').map(m => ({ id: m.id, response: db.getResponse('user1', m.id)! }))
  );

  processIngestionResponse(db, session!, 'yes');
  const result = processIngestionResponse(db, session!, 'maybe');

  if (result.startRanking) {
    const transitionResult = simulateIngestionToRankingTransition(db, session!);
    printSession(session, 'After transition');
    return transitionResult;
  }
  return {};
});

runTest('P2-C: Ingest maybe then yes', () => {
  db.clear();
  db.addMovie(1, 'Movie A');
  db.addMovie(2, 'Movie B');

  const session = createSession(
    db, 'user1',
    db.getUnrespondedMovies('user1').map(m => m.id),
    db.getMoviesToRank('user1').map(m => ({ id: m.id, response: db.getResponse('user1', m.id)! }))
  );

  processIngestionResponse(db, session!, 'maybe');
  const result = processIngestionResponse(db, session!, 'yes');

  if (result.startRanking) {
    const transitionResult = simulateIngestionToRankingTransition(db, session!);
    printSession(session, 'After transition');
    return transitionResult;
  }
  return {};
});

runTest('P2-D: Ingest single yes', () => {
  db.clear();
  db.addMovie(1, 'Movie A');

  const session = createSession(
    db, 'user1',
    db.getUnrespondedMovies('user1').map(m => m.id),
    db.getMoviesToRank('user1').map(m => ({ id: m.id, response: db.getResponse('user1', m.id)! }))
  );

  const result = processIngestionResponse(db, session!, 'yes');

  if (result.startRanking) {
    const transitionResult = simulateIngestionToRankingTransition(db, session!);
    printSession(session, 'After transition');
    return transitionResult;
  }
  return {};
});

runTest('P2-E: Three movies - yes, maybe, yes', () => {
  db.clear();
  db.addMovie(1, 'Movie A');
  db.addMovie(2, 'Movie B');
  db.addMovie(3, 'Movie C');

  const session = createSession(
    db, 'user1',
    db.getUnrespondedMovies('user1').map(m => m.id),
    db.getMoviesToRank('user1').map(m => ({ id: m.id, response: db.getResponse('user1', m.id)! }))
  );

  processIngestionResponse(db, session!, 'yes');
  processIngestionResponse(db, session!, 'maybe');
  const result = processIngestionResponse(db, session!, 'yes');

  if (result.startRanking) {
    const transitionResult = simulateIngestionToRankingTransition(db, session!);
    printSession(session, 'After transition');
    return transitionResult;
  }
  return {};
});

// Summary
console.log('\n\n');
console.log('█'.repeat(70));
console.log('TEST SUMMARY');
console.log('█'.repeat(70));

const passed = tests.filter(t => t.passed).length;
const failed = tests.filter(t => !t.passed).length;

console.log(`\nPassed: ${passed}/${tests.length}`);
console.log(`Failed: ${failed}/${tests.length}`);

if (failed > 0) {
  console.log('\n❌ FAILED:');
  tests.filter(t => !t.passed).forEach(t => console.log(`  - ${t.name}: ${t.error}`));
}

process.exit(failed > 0 ? 1 : 0);
