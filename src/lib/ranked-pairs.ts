/**
 * Generic Ranked Pairs (Tideman) election algorithm.
 * Shared between movie Condorcet ranking and general-purpose votes.
 */

/**
 * Check if adding an edge from 'from' to 'to' would create a cycle.
 * Uses DFS to check if 'to' can reach 'from' via existing locked edges.
 */
export function wouldCreateCycle(
  locked: Map<number, Set<number>>,
  from: number,
  to: number
): boolean {
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

export interface PairwiseMargin {
  winner: number;
  loser: number;
  margin: number;
}

export interface RankedPairsResult {
  ranking: number[];
  locked: Map<number, Set<number>>;
  wins: Map<number, number>;
  losses: Map<number, number>;
}

/**
 * Run Ranked Pairs (Tideman) election on a pairwise vote matrix.
 *
 * @param itemIds - IDs of all candidates
 * @param matrix - Map of `${idA}:${idB}` -> votes for A over B
 * @param tiebreaker - optional comparator for sorting tied sources (default: numeric)
 * @returns ranking order, locked graph, wins/losses
 */
export function rankedPairsElection(
  itemIds: number[],
  matrix: Map<string, number>,
  tiebreaker?: (a: number, b: number) => number
): RankedPairsResult {
  const pairs: PairwiseMargin[] = [];
  const tieCount = new Map<number, number>();

  for (const id of itemIds) {
    tieCount.set(id, 0);
  }

  // Calculate margins for all pairs
  for (let i = 0; i < itemIds.length; i++) {
    for (let j = i + 1; j < itemIds.length; j++) {
      const a = itemIds[i];
      const b = itemIds[j];

      const votesForA = matrix.get(`${a}:${b}`) ?? 0;
      const votesForB = matrix.get(`${b}:${a}`) ?? 0;

      if (votesForA > votesForB) {
        pairs.push({ winner: a, loser: b, margin: votesForA - votesForB });
      } else if (votesForB > votesForA) {
        pairs.push({ winner: b, loser: a, margin: votesForB - votesForA });
      } else {
        tieCount.set(a, tieCount.get(a)! + 1);
        tieCount.set(b, tieCount.get(b)! + 1);
      }
    }
  }

  // Sort pairs by margin (highest first)
  pairs.sort((a, b) => b.margin - a.margin);

  // Lock in pairs that don't create cycles
  const locked = new Map<number, Set<number>>();
  for (const id of itemIds) {
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
  for (const id of itemIds) {
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
  const inDegree = new Map<number, number>();
  for (const id of itemIds) {
    inDegree.set(id, 0);
  }
  for (const [, losers] of locked) {
    for (const loser of losers) {
      inDegree.set(loser, inDegree.get(loser)! + 1);
    }
  }

  const ranking: number[] = [];
  const remaining = new Set(itemIds);
  const cmp = tiebreaker ?? ((a, b) => a - b);

  while (remaining.size > 0) {
    const sources: number[] = [];
    for (const id of remaining) {
      if (inDegree.get(id) === 0) {
        sources.push(id);
      }
    }

    if (sources.length === 0) {
      // Cycle (shouldn't happen with cycle detection) — add rest
      ranking.push(...[...remaining].sort(cmp));
      break;
    }

    sources.sort(cmp);

    const next = sources[0];
    ranking.push(next);
    remaining.delete(next);

    const neighbors = locked.get(next);
    if (neighbors) {
      for (const neighbor of neighbors) {
        inDegree.set(neighbor, inDegree.get(neighbor)! - 1);
      }
    }
  }

  return { ranking, locked, wins, losses };
}
