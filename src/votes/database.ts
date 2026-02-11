import initSqlJs, { Database, BindParams } from 'sql.js';
import * as fs from 'fs';
import * as path from 'path';
import { rankedPairsElection } from '../lib/ranked-pairs';

const dbPath = path.join(process.cwd(), 'data', 'votes.db');
const schemaPath = path.join(process.cwd(), 'src', 'votes', 'schema.sql');

let db: Database;

function getDb(): Database {
  if (!db) {
    throw new Error('Vote database not initialized. Call initializeVoteDatabase() first.');
  }
  return db;
}

function queryOne<T>(sql: string, params: BindParams = []): T | undefined {
  const d = getDb();
  const stmt = d.prepare(sql);
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
  const d = getDb();
  const stmt = d.prepare(sql);
  stmt.bind(params);
  const results: T[] = [];
  while (stmt.step()) {
    results.push(stmt.getAsObject() as T);
  }
  stmt.free();
  return results;
}

function execute(sql: string, params: BindParams = []): { lastInsertRowid: number; changes: number } {
  const d = getDb();
  d.run(sql, params);
  const lastId = queryOne<{ id: number }>('SELECT last_insert_rowid() as id');
  const changes = queryOne<{ changes: number }>('SELECT changes() as changes');
  saveVoteDatabase();
  return {
    lastInsertRowid: lastId?.id ?? 0,
    changes: changes?.changes ?? 0,
  };
}

// --- Init / persistence ---

export async function initializeVoteDatabase(): Promise<void> {
  const SQL = await initSqlJs();

  const dataDir = path.dirname(dbPath);
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }

  if (fs.existsSync(dbPath)) {
    const buffer = fs.readFileSync(dbPath);
    db = new SQL.Database(buffer);
  } else {
    db = new SQL.Database();
  }

  db.exec('PRAGMA foreign_keys = ON');

  const schema = fs.readFileSync(schemaPath, 'utf-8');
  db.exec(schema);

  saveVoteDatabase();
}

export function saveVoteDatabase(): void {
  if (!db) return;
  const data = db.export();
  const buffer = Buffer.from(data);
  fs.writeFileSync(dbPath, buffer);
}

setInterval(saveVoteDatabase, 30000);
process.on('exit', saveVoteDatabase);
process.on('SIGINT', () => { saveVoteDatabase(); process.exit(); });
process.on('SIGTERM', () => { saveVoteDatabase(); process.exit(); });

// --- Types ---

export interface Vote {
  id: number;
  title: string;
  creator_id: string;
  channel_id: string;
  message_id: string | null;
  duration_hours: number;
  created_at: number;
  ends_at: number;
  status: string;
}

export interface VoteOption {
  id: number;
  vote_id: number;
  label: string;
}

export interface VotePreference {
  user_id: string;
  vote_id: number;
  option_a_id: number;
  option_b_id: number;
  preference: number;
}

// --- Vote CRUD ---

export function createVote(
  title: string,
  creatorId: string,
  channelId: string,
  durationHours: number,
  options: string[]
): { voteId: number; optionIds: number[] } {
  const now = Date.now();
  const endsAt = now + durationHours * 60 * 60 * 1000;

  const { lastInsertRowid: voteId } = execute(
    `INSERT INTO votes (title, creator_id, channel_id, duration_hours, created_at, ends_at, status)
     VALUES (?, ?, ?, ?, ?, ?, 'active')`,
    [title, creatorId, channelId, durationHours, now, endsAt]
  );

  const optionIds: number[] = [];
  for (const label of options) {
    const { lastInsertRowid } = execute(
      'INSERT INTO vote_options (vote_id, label) VALUES (?, ?)',
      [voteId, label.trim()]
    );
    optionIds.push(lastInsertRowid);
  }

  return { voteId, optionIds };
}

export function getVote(voteId: number): Vote | undefined {
  return queryOne<Vote>('SELECT * FROM votes WHERE id = ?', [voteId]);
}

export function setVoteMessageId(voteId: number, messageId: string): void {
  execute('UPDATE votes SET message_id = ? WHERE id = ?', [messageId, voteId]);
}

export function getActiveVotes(): Vote[] {
  return queryAll<Vote>("SELECT * FROM votes WHERE status = 'active' ORDER BY created_at ASC");
}

export function completeVote(voteId: number): void {
  execute("UPDATE votes SET status = 'completed' WHERE id = ?", [voteId]);
}

// --- Options ---

export function getVoteOptions(voteId: number): VoteOption[] {
  return queryAll<VoteOption>('SELECT * FROM vote_options WHERE vote_id = ? ORDER BY id ASC', [voteId]);
}

export function getOptionById(optionId: number): VoteOption | undefined {
  return queryOne<VoteOption>('SELECT * FROM vote_options WHERE id = ?', [optionId]);
}

// --- Preferences ---

export function recordPreference(userId: string, voteId: number, optionAId: number, optionBId: number, preference: number): void {
  execute(
    `INSERT INTO vote_preferences (user_id, vote_id, option_a_id, option_b_id, preference)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(user_id, vote_id, option_a_id, option_b_id) DO UPDATE SET preference = ?`,
    [userId, voteId, optionAId, optionBId, preference, preference]
  );
}

export function getPreferencesForUser(userId: string, voteId: number): VotePreference[] {
  return queryAll<VotePreference>(
    'SELECT * FROM vote_preferences WHERE user_id = ? AND vote_id = ?',
    [userId, voteId]
  );
}

export function deletePreferencesForUser(userId: string, voteId: number): void {
  execute(
    'DELETE FROM vote_preferences WHERE user_id = ? AND vote_id = ?',
    [userId, voteId]
  );
}

export function getVoterCount(voteId: number): number {
  const result = queryOne<{ count: number }>(
    'SELECT COUNT(DISTINCT user_id) as count FROM vote_preferences WHERE vote_id = ?',
    [voteId]
  );
  return result?.count ?? 0;
}

export function getVoterIds(voteId: number): string[] {
  const rows = queryAll<{ user_id: string }>(
    'SELECT DISTINCT user_id FROM vote_preferences WHERE vote_id = ?',
    [voteId]
  );
  return rows.map(r => r.user_id);
}

// --- Rankings (per-user topological sort, same algorithm as computeRankings in queries.ts) ---

export function computeVoteRankings(userId: string, voteId: number): { ranked: number[]; unranked: number[] } {
  const prefs = getPreferencesForUser(userId, voteId);
  const options = getVoteOptions(voteId);
  const optionIds = options.map(o => o.id);

  if (prefs.length === 0) return { ranked: [], unranked: optionIds };

  const comparedIds = new Set<number>();
  for (const p of prefs) {
    comparedIds.add(p.option_a_id);
    comparedIds.add(p.option_b_id);
  }

  const toRank = optionIds.filter(id => comparedIds.has(id));
  const neverCompared = optionIds.filter(id => !comparedIds.has(id));

  if (toRank.length === 0) return { ranked: [], unranked: optionIds };

  // Build directed graph
  const graph = new Map<number, Set<number>>();
  const inDegree = new Map<number, number>();
  for (const id of toRank) {
    graph.set(id, new Set());
    inDegree.set(id, 0);
  }

  for (const p of prefs) {
    const a = p.option_a_id;
    const b = p.option_b_id;
    if (!graph.has(a) || !graph.has(b)) continue;

    if (p.preference > 0) {
      if (!graph.get(a)!.has(b)) {
        graph.get(a)!.add(b);
        inDegree.set(b, inDegree.get(b)! + 1);
      }
    } else if (p.preference < 0) {
      if (!graph.get(b)!.has(a)) {
        graph.get(b)!.add(a);
        inDegree.set(a, inDegree.get(a)! + 1);
      }
    }
  }

  // Connected components via undirected comparison graph
  const compGraph = new Map<number, Set<number>>();
  for (const id of toRank) compGraph.set(id, new Set());
  for (const p of prefs) {
    if (compGraph.has(p.option_a_id) && compGraph.has(p.option_b_id)) {
      compGraph.get(p.option_a_id)!.add(p.option_b_id);
      compGraph.get(p.option_b_id)!.add(p.option_a_id);
    }
  }

  const visited = new Set<number>();
  const components: number[][] = [];
  for (const id of toRank) {
    if (visited.has(id)) continue;
    const component: number[] = [];
    const stack = [id];
    while (stack.length > 0) {
      const node = stack.pop()!;
      if (visited.has(node)) continue;
      visited.add(node);
      component.push(node);
      for (const n of compGraph.get(node) ?? []) {
        if (!visited.has(n)) stack.push(n);
      }
    }
    components.push(component);
  }

  components.sort((a, b) => b.length - a.length);
  const main = new Set(components[0] ?? []);
  const unrankedFromComponents = toRank.filter(id => !main.has(id));

  // Toposort main component
  const compInDeg = new Map<number, number>();
  for (const id of main) compInDeg.set(id, 0);
  for (const [from, tos] of graph) {
    if (!main.has(from)) continue;
    for (const to of tos) {
      if (main.has(to)) compInDeg.set(to, compInDeg.get(to)! + 1);
    }
  }

  const ranked: number[] = [];
  const remaining = new Set(main);

  while (remaining.size > 0) {
    const sources: number[] = [];
    for (const id of remaining) {
      if (compInDeg.get(id) === 0) sources.push(id);
    }
    if (sources.length === 0) break; // cycle

    sources.sort((a, b) => a - b);
    for (const id of sources) {
      ranked.push(id);
      remaining.delete(id);
      for (const neighbor of graph.get(id) ?? []) {
        if (remaining.has(neighbor)) {
          compInDeg.set(neighbor, compInDeg.get(neighbor)! - 1);
        }
      }
    }
  }

  return { ranked, unranked: [...unrankedFromComponents, ...neverCompared] };
}

// --- Aggregate results (Ranked Pairs election) ---

export interface VoteResult {
  optionId: number;
  label: string;
  wins: number;
  losses: number;
}

export function computeVoteResults(voteId: number): VoteResult[] {
  const options = getVoteOptions(voteId);
  if (options.length === 0) return [];

  const optionIds = options.map(o => o.id);
  const optionMap = new Map(options.map(o => [o.id, o]));

  // Get all voters
  const voters = queryAll<{ user_id: string }>(
    'SELECT DISTINCT user_id FROM vote_preferences WHERE vote_id = ?',
    [voteId]
  );

  if (voters.length === 0) return options.map(o => ({ optionId: o.id, label: o.label, wins: 0, losses: 0 }));

  // Compute per-user rankings, then build aggregate vote matrix
  const userRankings = new Map<string, Map<number, number>>();
  for (const { user_id } of voters) {
    const { ranked } = computeVoteRankings(user_id, voteId);
    const rankMap = new Map<number, number>();
    ranked.forEach((id, idx) => rankMap.set(id, idx + 1));
    userRankings.set(user_id, rankMap);
  }

  const voteMatrix = new Map<string, number>();
  for (let i = 0; i < optionIds.length; i++) {
    for (let j = i + 1; j < optionIds.length; j++) {
      const a = optionIds[i];
      const b = optionIds[j];
      let votesA = 0;
      let votesB = 0;

      for (const [, rankMap] of userRankings) {
        const rA = rankMap.get(a);
        const rB = rankMap.get(b);
        if (rA !== undefined && rB !== undefined) {
          if (rA < rB) votesA++;
          else if (rB < rA) votesB++;
        } else if (rA !== undefined) {
          votesA++;
        } else if (rB !== undefined) {
          votesB++;
        }
      }

      voteMatrix.set(`${a}:${b}`, votesA);
      voteMatrix.set(`${b}:${a}`, votesB);
    }
  }

  const labelMap = new Map(options.map(o => [o.id, o.label]));
  const { ranking, wins, losses } = rankedPairsElection(optionIds, voteMatrix, (a, b) =>
    (labelMap.get(a) ?? '').localeCompare(labelMap.get(b) ?? '')
  );

  return ranking.map(id => ({
    optionId: id,
    label: optionMap.get(id)!.label,
    wins: wins.get(id) ?? 0,
    losses: losses.get(id) ?? 0,
  }));
}

// --- Pairwise matrix for graph visualization ---

export function computeVoteMatrix(voteId: number): { optionIds: number[]; labels: string[]; matrix: number[][] } {
  const options = getVoteOptions(voteId);
  const optionIds = options.map(o => o.id);
  const labels = options.map(o => o.label);
  const n = optionIds.length;

  const matrix: number[][] = Array(n).fill(null).map(() => Array(n).fill(0));

  const voters = queryAll<{ user_id: string }>(
    'SELECT DISTINCT user_id FROM vote_preferences WHERE vote_id = ?',
    [voteId]
  );

  if (voters.length === 0) return { optionIds, labels, matrix };

  const userRankings = new Map<string, Map<number, number>>();
  for (const { user_id } of voters) {
    const { ranked } = computeVoteRankings(user_id, voteId);
    const rankMap = new Map<number, number>();
    ranked.forEach((id, idx) => rankMap.set(id, idx + 1));
    userRankings.set(user_id, rankMap);
  }

  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      if (i === j) continue;
      const a = optionIds[i];
      const b = optionIds[j];

      for (const [, rankMap] of userRankings) {
        const rA = rankMap.get(a);
        const rB = rankMap.get(b);
        if (rA !== undefined && rB !== undefined) {
          if (rA < rB) matrix[i][j]++;
        } else if (rA !== undefined && rB === undefined) {
          matrix[i][j]++;
        }
      }
    }
  }

  return { optionIds, labels, matrix };
}

export function getWinnerExplanation(voteId: number): string {
  const results = computeVoteResults(voteId);
  if (results.length < 2) return '';

  const winner = results[0];
  const { optionIds, labels, matrix } = computeVoteMatrix(voteId);
  const n = optionIds.length;
  const winnerIdx = optionIds.indexOf(winner.optionId);

  // Condorcet winner: beats every other option head-to-head
  let isCondorcet = true;
  for (let j = 0; j < n; j++) {
    if (j === winnerIdx) continue;
    if (matrix[winnerIdx][j] <= matrix[j][winnerIdx]) {
      isCondorcet = false;
      break;
    }
  }

  if (isCondorcet) {
    return `Winner **${winner.label}** is the Condorcet winner.`;
  }

  // Find the cycle: follow h2h defeats starting from the winner
  // until we loop back. winner -> who beats winner -> who beats that -> ... -> winner
  const beatsByIdx = new Map<number, number[]>();
  for (let i = 0; i < n; i++) {
    const beaters: number[] = [];
    for (let j = 0; j < n; j++) {
      if (j !== i && matrix[j][i] > matrix[i][j]) beaters.push(j);
    }
    beatsByIdx.set(i, beaters);
  }

  // BFS/DFS to find a shortest cycle through the winner
  const cycleMembers = new Set<number>();
  cycleMembers.add(winnerIdx);
  const queue = [winnerIdx];
  const visited = new Set<number>();
  while (queue.length > 0) {
    const cur = queue.shift()!;
    if (visited.has(cur)) continue;
    visited.add(cur);
    for (const beater of beatsByIdx.get(cur) ?? []) {
      cycleMembers.add(beater);
      if (!visited.has(beater)) queue.push(beater);
    }
  }

  const cycleNames = [...cycleMembers].map(i => labels[i]);

  return `Winner **${winner.label}** is the highest-margin winner within cycle ${cycleNames.join(', ')}.`;
}
