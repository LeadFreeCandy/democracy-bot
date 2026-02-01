/**
 * Test helpers for database testing.
 * Provides in-memory database setup and test data utilities.
 */
import initSqlJs, { Database } from 'sql.js';

let testDb: Database | null = null;

/**
 * Initialize an in-memory test database with the schema.
 */
export async function setupTestDatabase(): Promise<Database> {
  const SQL = await initSqlJs();
  testDb = new SQL.Database();

  // Enable foreign keys
  testDb.exec('PRAGMA foreign_keys = ON');

  // Create schema
  testDb.exec(`
    CREATE TABLE IF NOT EXISTS movies (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL UNIQUE COLLATE NOCASE,
      submitted_by TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      watched INTEGER DEFAULT 0,
      watched_at INTEGER
    );

    CREATE TABLE IF NOT EXISTS pairwise_preferences (
      user_id TEXT NOT NULL,
      movie_a_id INTEGER NOT NULL,
      movie_b_id INTEGER NOT NULL,
      preference INTEGER NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      FOREIGN KEY (movie_a_id) REFERENCES movies(id) ON DELETE CASCADE,
      FOREIGN KEY (movie_b_id) REFERENCES movies(id) ON DELETE CASCADE,
      PRIMARY KEY (user_id, movie_a_id, movie_b_id)
    );

    CREATE TABLE IF NOT EXISTS attendance (
      user_id TEXT NOT NULL,
      event_date TEXT NOT NULL,
      attending INTEGER NOT NULL DEFAULT 1,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      PRIMARY KEY (user_id, event_date)
    );
  `);

  return testDb;
}

/**
 * Get the test database instance.
 */
export function getTestDb(): Database {
  if (!testDb) {
    throw new Error('Test database not initialized. Call setupTestDatabase() first.');
  }
  return testDb;
}

/**
 * Clear all data from the test database.
 */
export function clearTestData(): void {
  if (!testDb) return;
  testDb.exec('DELETE FROM pairwise_preferences');
  testDb.exec('DELETE FROM attendance');
  testDb.exec('DELETE FROM movies');
}

/**
 * Close the test database.
 */
export function closeTestDatabase(): void {
  if (testDb) {
    testDb.close();
    testDb = null;
  }
}

/**
 * Add a movie to the test database.
 */
export function addMovie(id: number, title: string): void {
  const db = getTestDb();
  const now = Date.now();
  db.run(
    'INSERT INTO movies (id, title, submitted_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
    [id, title, 'test_user', now, now]
  );
}

/**
 * Add a pairwise preference.
 * preference: 1 = prefer A, -1 = prefer B, 0 = tie
 */
export function addPreference(
  userId: string,
  movieAId: number,
  movieBId: number,
  preference: number
): void {
  const db = getTestDb();
  const now = Date.now();
  db.run(
    `INSERT INTO pairwise_preferences (user_id, movie_a_id, movie_b_id, preference, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [userId, movieAId, movieBId, preference, now, now]
  );
}

/**
 * Add attendance for a user on a specific date.
 */
export function addAttendance(userId: string, eventDate: string, attending: boolean = true): void {
  const db = getTestDb();
  const now = Date.now();
  db.run(
    `INSERT INTO attendance (user_id, event_date, attending, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?)`,
    [userId, eventDate, attending ? 1 : 0, now, now]
  );
}

/**
 * Get the next Wednesday date string (for attendance).
 */
export function getNextWednesdayDate(): string {
  const now = new Date();
  const dayOfWeek = now.getDay();
  let daysUntilWednesday = (3 - dayOfWeek + 7) % 7;
  if (daysUntilWednesday === 0) daysUntilWednesday = 0;
  const nextWed = new Date(now.getFullYear(), now.getMonth(), now.getDate() + daysUntilWednesday);
  return nextWed.toISOString().split('T')[0];
}
