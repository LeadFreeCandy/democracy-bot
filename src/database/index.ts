import initSqlJs, { Database } from 'sql.js';
import * as fs from 'fs';
import * as path from 'path';

const dbPath = path.join(process.cwd(), 'data', 'movies.db');
const schemaPath = path.join(process.cwd(), 'src', 'database', 'schema.sql');

// Ensure data directory exists
const dataDir = path.dirname(dbPath);
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

let db: Database;

export function getDb(): Database {
  if (!db) {
    throw new Error('Database not initialized. Call initializeDatabase() first.');
  }
  return db;
}

export async function initializeDatabase(): Promise<void> {
  const SQL = await initSqlJs();

  // Load existing database or create new one
  if (fs.existsSync(dbPath)) {
    const buffer = fs.readFileSync(dbPath);
    db = new SQL.Database(buffer);
  } else {
    db = new SQL.Database();
  }

  // Enable foreign keys
  db.exec('PRAGMA foreign_keys = ON');

  // Initialize schema (exec handles multiple statements)
  const schema = fs.readFileSync(schemaPath, 'utf-8');
  db.exec(schema);

  // Migration: drop old responses table from movie check phase (no longer used)
  db.exec('DROP TABLE IF EXISTS responses');

  // Save database
  saveDatabase();
}

export function saveDatabase(): void {
  if (!db) return;
  const data = db.export();
  const buffer = Buffer.from(data);
  fs.writeFileSync(dbPath, buffer);
}

// Save periodically and on process exit
setInterval(saveDatabase, 30000); // Every 30 seconds

process.on('exit', saveDatabase);
process.on('SIGINT', () => {
  saveDatabase();
  process.exit();
});
process.on('SIGTERM', () => {
  saveDatabase();
  process.exit();
});
