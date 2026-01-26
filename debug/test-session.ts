/**
 * Comprehensive testing interface for debugging session state issues.
 * Run with: npx tsx debug/test-session.ts
 *
 * This file is completely independent of the main bot code and uses
 * mocked database functions to simulate various scenarios.
 */

// ============================================================================
// Types (copied from source for independence)
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
  messageId?: string;
  channelId?: string;
  createdAt: number;
}

interface Movie {
  id: number;
  title: string;
  submitted_by: string;
  watched: number;
}

interface MovieResponse {
  user_id: string;
  movie_id: number;
  response: 'yes' | 'no' | 'maybe';
}

interface PairwisePreference {
  user_id: string;
  movie_a_id: number;
  movie_b_id: number;
  preference: number;
}

// ============================================================================
// Mock Database
// ============================================================================

class MockDatabase {
  movies: Movie[] = [];
  responses: MovieResponse[] = [];
  preferences: PairwisePreference[] = [];

  addMovie(id: number, title: string): void {
    this.movies.push({ id, title, submitted_by: 'test-user', watched: 0 });
  }

  addResponse(userId: string, movieId: number, response: 'yes' | 'no' | 'maybe'): void {
    // Update existing or add new
    const existing = this.responses.find(r => r.user_id === userId && r.movie_id === movieId);
    if (existing) {
      existing.response = response;
    } else {
      this.responses.push({ user_id: userId, movie_id: movieId, response });
    }
  }

  addPreference(userId: string, movieAId: number, movieBId: number, preference: number): void {
    this.preferences.push({ user_id: userId, movie_a_id: movieAId, movie_b_id: movieBId, preference });
  }

  getUnrespondedMovies(userId: string): Movie[] {
    const respondedIds = new Set(
      this.responses.filter(r => r.user_id === userId).map(r => r.movie_id)
    );
    return this.movies.filter(m => m.watched === 0 && !respondedIds.has(m.id));
  }

  getMoviesToRank(userId: string): Movie[] {
    const yesOrMaybeIds = new Set(
      this.responses
        .filter(r => r.user_id === userId && r.response !== 'no')
        .map(r => r.movie_id)
    );
    return this.movies.filter(m => m.watched === 0 && yesOrMaybeIds.has(m.id));
  }

  getResponse(userId: string, movieId: number): 'yes' | 'no' | 'maybe' | undefined {
    const r = this.responses.find(r => r.user_id === userId && r.movie_id === movieId);
    return r?.response;
  }

  getPreferencesForUser(userId: string): PairwisePreference[] {
    return this.preferences.filter(p => p.user_id === userId);
  }

  getMovieById(id: number): Movie | undefined {
    return this.movies.find(m => m.id === id);
  }

  clear(): void {
    this.movies = [];
    this.responses = [];
    this.preferences = [];
  }
}

// ============================================================================
// Session Logic (EXACT copy from src/ranking/session.ts)
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

  if (session.pendingMovies.length > 0) {
    const firstMovie = session.pendingMovies.shift()!;
    session.movieToInsert = firstMovie;
    session.low = 0;
    const movieResponse = db.getResponse(session.userId, firstMovie);
    if (movieResponse === 'maybe') {
      session.low = session.sortedList.length;
    }
    session.high = session.sortedList.length;
    session.currentMid = Math.floor((session.low + session.high) / 2);
  }
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

// Simulates processIngestionResponse from session.ts
function processIngestionResponse(
  db: MockDatabase,
  session: RankingSession,
  response: 'yes' | 'no' | 'maybe'
): { done: boolean; startRanking: boolean } {
  if (session.phase !== 'ingestion' || session.currentIngestionMovie === null) {
    return { done: true, startRanking: false };
  }

  // Save response
  db.addResponse(session.userId, session.currentIngestionMovie, response);
  session.ingestionCount++;

  // Remove from pending and get next
  session.pendingIngestion.shift();

  if (session.pendingIngestion.length === 0) {
    // Ingestion done, check if we need to rank
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

// Simulates the handleIngestionResponse transition to ranking phase
// This is from buttons.ts lines 332-378
function simulateIngestionToRankingTransition(
  db: MockDatabase,
  session: RankingSession
): { error?: string; completed?: boolean } {
  // Check if there's actually something to rank
  if (session.movieToInsert === 0 || (session.sortedList.length === 0 && session.pendingMovies.length === 0)) {
    return { completed: true }; // Nothing to rank
  }

  // Handle case where there's only one movie to rank
  if (session.sortedList.length === 0 && session.pendingMovies.length === 0 && session.movieToInsert) {
    session.sortedList = [session.movieToInsert];
    session.moviesRankedThisSession = 1;
    return { completed: true };
  }

  // Need at least 2 movies to compare
  if (session.sortedList.length === 0 && session.movieToInsert) {
    // First movie goes in automatically
    session.sortedList = [session.movieToInsert];
    session.moviesRankedThisSession = 1;

    if (session.pendingMovies.length === 0) {
      return { completed: true };
    }

    // Set up next movie for comparison
    session.movieToInsert = session.pendingMovies.shift()!;
    session.low = 0;
    const movieResponse = db.getResponse(session.userId, session.movieToInsert);
    if (movieResponse === 'maybe') {
      session.low = session.sortedList.length;
    }
    session.high = session.sortedList.length;
    session.currentMid = Math.floor((session.low + session.high) / 2);
  }

  // Now validate that we can call buildComparisonMessage
  return validateComparisonState(session);
}

// ============================================================================
// Validation Functions (mimics src/components/comparison.ts)
// ============================================================================

function validateComparisonState(session: RankingSession): { error?: string } {
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
// Test Runner
// ============================================================================

interface TestResult {
  name: string;
  passed: boolean;
  error?: string;
}

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
  console.log(`  low: ${session.low}, high: ${session.high}, currentMid: ${session.currentMid}`);
  console.log(`  pendingIngestion: [${session.pendingIngestion.join(', ')}]`);
}

const tests: TestResult[] = [];

function runTest(name: string, testFn: () => { error?: string }): void {
  console.log(`\n${'='.repeat(70)}`);
  console.log(`TEST: ${name}`);
  console.log('='.repeat(70));

  try {
    const result = testFn();

    if (result.error) {
      console.log(`\n  ❌ VALIDATION FAILED: ${result.error}`);
      tests.push({ name, passed: false, error: result.error });
    } else {
      console.log(`\n  ✅ Test passed`);
      tests.push({ name, passed: true });
    }
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    console.log(`\n  ❌ EXCEPTION: ${error}`);
    tests.push({ name, passed: false, error });
  }
}

// ============================================================================
// Test Cases - Path 1: Direct to ranking (no ingestion needed)
// ============================================================================

const db = new MockDatabase();

console.log('\n' + '█'.repeat(70));
console.log('PATH 1: DIRECT TO RANKING (no unresponded movies)');
console.log('█'.repeat(70));

runTest('P1-A: Two yes responses, no prior rankings', () => {
  db.clear();
  db.addMovie(1, 'Movie A');
  db.addMovie(2, 'Movie B');
  db.addResponse('user1', 1, 'yes');
  db.addResponse('user1', 2, 'yes');

  const unresponded = db.getUnrespondedMovies('user1');
  const toRank = db.getMoviesToRank('user1');

  console.log(`  Setup: 2 movies, both 'yes', no preferences`);
  console.log(`  Unresponded: [${unresponded.map(m => m.id).join(', ')}]`);
  console.log(`  To rank: [${toRank.map(m => m.id).join(', ')}]`);

  const session = createSession(
    db,
    'user1',
    unresponded.map(m => m.id),
    toRank.map(m => ({ id: m.id, response: db.getResponse('user1', m.id)! }))
  );

  printSession(session, 'After createSession');
  return validateComparisonState(session!);
});

runTest('P1-B: Single yes response, no prior rankings', () => {
  db.clear();
  db.addMovie(1, 'Movie A');
  db.addResponse('user1', 1, 'yes');

  const unresponded = db.getUnrespondedMovies('user1');
  const toRank = db.getMoviesToRank('user1');

  console.log(`  Setup: 1 movie, 'yes', no preferences`);

  const session = createSession(
    db,
    'user1',
    unresponded.map(m => m.id),
    toRank.map(m => ({ id: m.id, response: db.getResponse('user1', m.id)! }))
  );

  printSession(session, 'After createSession');
  return validateComparisonState(session!);
});

runTest('P1-C: Yes + Maybe responses, no prior rankings', () => {
  db.clear();
  db.addMovie(1, 'Movie A');
  db.addMovie(2, 'Movie B');
  db.addResponse('user1', 1, 'yes');
  db.addResponse('user1', 2, 'maybe');

  const unresponded = db.getUnrespondedMovies('user1');
  const toRank = db.getMoviesToRank('user1');

  console.log(`  Setup: 2 movies, 'yes' + 'maybe', no preferences`);

  const session = createSession(
    db,
    'user1',
    unresponded.map(m => m.id),
    toRank.map(m => ({ id: m.id, response: db.getResponse('user1', m.id)! }))
  );

  printSession(session, 'After createSession');
  return validateComparisonState(session!);
});

runTest('P1-D: Two maybe responses, no prior rankings', () => {
  db.clear();
  db.addMovie(1, 'Movie A');
  db.addMovie(2, 'Movie B');
  db.addResponse('user1', 1, 'maybe');
  db.addResponse('user1', 2, 'maybe');

  const unresponded = db.getUnrespondedMovies('user1');
  const toRank = db.getMoviesToRank('user1');

  console.log(`  Setup: 2 movies, both 'maybe', no preferences`);

  const session = createSession(
    db,
    'user1',
    unresponded.map(m => m.id),
    toRank.map(m => ({ id: m.id, response: db.getResponse('user1', m.id)! }))
  );

  printSession(session, 'After createSession');
  return validateComparisonState(session!);
});

runTest('P1-E: Yes + Maybe + No responses (user bug report)', () => {
  db.clear();
  db.addMovie(1, 'Movie A');
  db.addMovie(2, 'Movie B');
  db.addMovie(3, 'Movie C');
  db.addResponse('user1', 1, 'yes');
  db.addResponse('user1', 2, 'maybe');
  db.addResponse('user1', 3, 'no');

  const unresponded = db.getUnrespondedMovies('user1');
  const toRank = db.getMoviesToRank('user1');

  console.log(`  Setup: 3 movies with yes, maybe, no responses`);
  console.log(`  Unresponded: [${unresponded.map(m => m.id).join(', ')}]`);
  console.log(`  To rank: [${toRank.map(m => m.id).join(', ')}]`);

  const session = createSession(
    db,
    'user1',
    unresponded.map(m => m.id),
    toRank.map(m => ({ id: m.id, response: db.getResponse('user1', m.id)! }))
  );

  printSession(session, 'After createSession');

  // This is what handleRankMovies checks before calling buildComparisonMessage
  if (session!.sortedList.length === 0 && session!.pendingMovies.length === 0) {
    console.log('  -> Would show "no movies to rank" message');
    return {};
  }

  // NEW CHECK: If movieToInsert is 0, ranking is complete (all auto-inserted)
  if (session!.movieToInsert === 0) {
    console.log('  -> All movies auto-inserted, ranking complete!');
    console.log(`  -> Would show completion message with ${session!.moviesRankedThisSession} movies ranked`);
    return {}; // This is valid - no comparison needed
  }

  return validateComparisonState(session!);
});

// ============================================================================
// Test Cases - Path 2: Through ingestion, then transition to ranking
// ============================================================================

console.log('\n' + '█'.repeat(70));
console.log('PATH 2: INGESTION -> RANKING TRANSITION');
console.log('█'.repeat(70));

runTest('P2-A: Ingest 2 movies as yes, then transition to ranking', () => {
  db.clear();
  db.addMovie(1, 'Movie A');
  db.addMovie(2, 'Movie B');

  const unresponded = db.getUnrespondedMovies('user1');
  const toRank = db.getMoviesToRank('user1');

  console.log(`  Setup: 2 unresponded movies`);

  const session = createSession(
    db,
    'user1',
    unresponded.map(m => m.id),
    toRank.map(m => ({ id: m.id, response: db.getResponse('user1', m.id)! }))
  );

  printSession(session, 'After createSession (ingestion phase)');

  // Simulate user responding "yes" to first movie
  let result = processIngestionResponse(db, session!, 'yes');
  console.log(`  After first 'yes': done=${result.done}, startRanking=${result.startRanking}`);
  printSession(session, 'After first response');

  // Simulate user responding "yes" to second movie
  result = processIngestionResponse(db, session!, 'yes');
  console.log(`  After second 'yes': done=${result.done}, startRanking=${result.startRanking}`);
  printSession(session, 'After second response (should transition to ranking)');

  if (result.startRanking) {
    // This is what handleIngestionResponse does
    const transitionResult = simulateIngestionToRankingTransition(db, session!);
    printSession(session, 'After transition logic');
    return transitionResult;
  }

  return {};
});

runTest('P2-B: Ingest yes then maybe, transition to ranking', () => {
  db.clear();
  db.addMovie(1, 'Movie A');
  db.addMovie(2, 'Movie B');

  const unresponded = db.getUnrespondedMovies('user1');
  const toRank = db.getMoviesToRank('user1');

  console.log(`  Setup: 2 unresponded movies, will respond 'yes' then 'maybe'`);

  const session = createSession(
    db,
    'user1',
    unresponded.map(m => m.id),
    toRank.map(m => ({ id: m.id, response: db.getResponse('user1', m.id)! }))
  );

  let result = processIngestionResponse(db, session!, 'yes');
  console.log(`  After 'yes': done=${result.done}, startRanking=${result.startRanking}`);

  result = processIngestionResponse(db, session!, 'maybe');
  console.log(`  After 'maybe': done=${result.done}, startRanking=${result.startRanking}`);
  printSession(session, 'After ingestion complete');

  if (result.startRanking) {
    const transitionResult = simulateIngestionToRankingTransition(db, session!);
    printSession(session, 'After transition logic');
    return transitionResult;
  }

  return {};
});

runTest('P2-C: Ingest maybe then yes, transition to ranking', () => {
  db.clear();
  db.addMovie(1, 'Movie A');
  db.addMovie(2, 'Movie B');

  const unresponded = db.getUnrespondedMovies('user1');
  const toRank = db.getMoviesToRank('user1');

  console.log(`  Setup: 2 unresponded movies, will respond 'maybe' then 'yes'`);

  const session = createSession(
    db,
    'user1',
    unresponded.map(m => m.id),
    toRank.map(m => ({ id: m.id, response: db.getResponse('user1', m.id)! }))
  );

  let result = processIngestionResponse(db, session!, 'maybe');
  console.log(`  After 'maybe': done=${result.done}, startRanking=${result.startRanking}`);

  result = processIngestionResponse(db, session!, 'yes');
  console.log(`  After 'yes': done=${result.done}, startRanking=${result.startRanking}`);
  printSession(session, 'After ingestion complete');

  if (result.startRanking) {
    const transitionResult = simulateIngestionToRankingTransition(db, session!);
    printSession(session, 'After transition logic');
    return transitionResult;
  }

  return {};
});

runTest('P2-D: Ingest single movie as yes, transition', () => {
  db.clear();
  db.addMovie(1, 'Movie A');

  const unresponded = db.getUnrespondedMovies('user1');
  const toRank = db.getMoviesToRank('user1');

  console.log(`  Setup: 1 unresponded movie`);

  const session = createSession(
    db,
    'user1',
    unresponded.map(m => m.id),
    toRank.map(m => ({ id: m.id, response: db.getResponse('user1', m.id)! }))
  );

  const result = processIngestionResponse(db, session!, 'yes');
  console.log(`  After 'yes': done=${result.done}, startRanking=${result.startRanking}`);
  printSession(session, 'After ingestion');

  if (result.startRanking) {
    const transitionResult = simulateIngestionToRankingTransition(db, session!);
    printSession(session, 'After transition logic');
    return transitionResult;
  }

  return {};
});

runTest('P2-E: Three movies - yes, maybe, yes', () => {
  db.clear();
  db.addMovie(1, 'Movie A');
  db.addMovie(2, 'Movie B');
  db.addMovie(3, 'Movie C');

  const unresponded = db.getUnrespondedMovies('user1');
  const toRank = db.getMoviesToRank('user1');

  console.log(`  Setup: 3 unresponded movies, will respond 'yes', 'maybe', 'yes'`);

  const session = createSession(
    db,
    'user1',
    unresponded.map(m => m.id),
    toRank.map(m => ({ id: m.id, response: db.getResponse('user1', m.id)! }))
  );

  processIngestionResponse(db, session!, 'yes');
  processIngestionResponse(db, session!, 'maybe');
  const result = processIngestionResponse(db, session!, 'yes');

  console.log(`  After all responses: done=${result.done}, startRanking=${result.startRanking}`);
  printSession(session, 'After ingestion');

  if (result.startRanking) {
    const transitionResult = simulateIngestionToRankingTransition(db, session!);
    printSession(session, 'After transition logic');
    return transitionResult;
  }

  return {};
});

// ============================================================================
// Summary
// ============================================================================

console.log('\n\n');
console.log('█'.repeat(70));
console.log('TEST SUMMARY');
console.log('█'.repeat(70));

const passed = tests.filter(t => t.passed).length;
const failed = tests.filter(t => !t.passed).length;

console.log(`\nPassed: ${passed}/${tests.length}`);
console.log(`Failed: ${failed}/${tests.length}`);

if (failed > 0) {
  console.log('\n❌ FAILED TESTS:');
  for (const test of tests.filter(t => !t.passed)) {
    console.log(`\n  ${test.name}`);
    console.log(`    Error: ${test.error}`);
  }
}

console.log('\n');
console.log('█'.repeat(70));
console.log('ROOT CAUSE ANALYSIS');
console.log('█'.repeat(70));
console.log(`
TWO BUG LOCATIONS:

1. src/ranking/session.ts - setupRankingPhase() [lines ~94-112]
   When sortedList is empty, the first movie cannot be compared against anything.
   The code sets movieToInsert but there's no element in sortedList to compare.

2. src/handlers/buttons.ts - handleIngestionResponse() [lines ~366-375]
   After auto-inserting first movie, when setting up second movie:
   - If response is 'maybe', low = sortedList.length (e.g., 1)
   - high = sortedList.length (e.g., 1)
   - currentMid = floor((1+1)/2) = 1
   - But sortedList[1] is out of bounds when length is 1!

Both bugs stem from the same issue: when low >= high, the position is
already determined and no comparison is needed. The movie should be
inserted directly at position 'low'.
`);

process.exit(failed > 0 ? 1 : 0);
