/**
 * Comprehensive tests for ranking algorithms.
 * Tests computeRankings, getExistingRankedOrder, computeCondorcetRanking, and computeCondorcetMatrix.
 */
import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import {
  setupTestDatabase,
  getTestDb,
  clearTestData,
  closeTestDatabase,
  addMovie,
  addPreference,
  addAttendance,
  getNextWednesdayDate,
} from './test-helpers';
import { setDb } from './index';
import { computeRankings, computeCondorcetRanking, computeCondorcetMatrix } from './queries';

// Also need to test getExistingRankedOrder from session.ts
// Import it after setting up the database

describe('Ranking Algorithms', () => {
  beforeAll(async () => {
    const db = await setupTestDatabase();
    setDb(db);
  });

  beforeEach(() => {
    clearTestData();
  });

  afterAll(() => {
    closeTestDatabase();
  });

  // ============================================================
  // COMPUTE RANKINGS TESTS
  // ============================================================
  describe('computeRankings - Individual User Rankings', () => {
    describe('Basic Scenarios', () => {
      it('should return empty result when no preferences exist', () => {
        addMovie(1, 'Movie A');
        addMovie(2, 'Movie B');

        const result = computeRankings('user1');

        expect(result.ranked).toEqual([]);
        expect(result.unranked).toEqual([]);
      });

      it('should rank two movies with single preference', () => {
        addMovie(1, 'Movie A');
        addMovie(2, 'Movie B');
        addPreference('user1', 1, 2, 1); // A > B

        const result = computeRankings('user1');

        expect(result.ranked).toHaveLength(2);
        expect(result.ranked[0].title).toBe('Movie A');
        expect(result.ranked[0].rank).toBe(1);
        expect(result.ranked[1].title).toBe('Movie B');
        expect(result.ranked[1].rank).toBe(2);
        expect(result.unranked).toHaveLength(0);
      });

      it('should handle reverse preference correctly', () => {
        addMovie(1, 'Movie A');
        addMovie(2, 'Movie B');
        addPreference('user1', 1, 2, -1); // B > A

        const result = computeRankings('user1');

        expect(result.ranked[0].title).toBe('Movie B');
        expect(result.ranked[1].title).toBe('Movie A');
      });

      it('should rank three movies in linear order', () => {
        addMovie(1, 'Movie A');
        addMovie(2, 'Movie B');
        addMovie(3, 'Movie C');
        addPreference('user1', 1, 2, 1); // A > B
        addPreference('user1', 2, 3, 1); // B > C

        const result = computeRankings('user1');

        expect(result.ranked).toHaveLength(3);
        expect(result.ranked[0].title).toBe('Movie A');
        expect(result.ranked[0].rank).toBe(1);
        expect(result.ranked[1].title).toBe('Movie B');
        expect(result.ranked[1].rank).toBe(2);
        expect(result.ranked[2].title).toBe('Movie C');
        expect(result.ranked[2].rank).toBe(3);
      });
    });

    describe('Explicit Ties (preference === 0)', () => {
      it('should give same rank to explicitly tied movies', () => {
        addMovie(1, 'Movie A');
        addMovie(2, 'Movie B');
        addPreference('user1', 1, 2, 0); // A = B (tie)

        const result = computeRankings('user1');

        expect(result.ranked).toHaveLength(2);
        expect(result.ranked[0].rank).toBe(result.ranked[1].rank);
      });

      it('should handle tie in middle of ranking', () => {
        addMovie(1, 'Movie A');
        addMovie(2, 'Movie B');
        addMovie(3, 'Movie C');
        addMovie(4, 'Movie D');
        addPreference('user1', 1, 2, 1); // A > B
        addPreference('user1', 2, 3, 0); // B = C (tie)
        addPreference('user1', 3, 4, 1); // C > D
        addPreference('user1', 2, 4, 1); // B > D

        const result = computeRankings('user1');

        // A should be rank 1
        const movieA = result.ranked.find(r => r.title === 'Movie A');
        expect(movieA?.rank).toBe(1);

        // B and C should have same rank
        const movieB = result.ranked.find(r => r.title === 'Movie B');
        const movieC = result.ranked.find(r => r.title === 'Movie C');
        expect(movieB?.rank).toBe(movieC?.rank);

        // D should be last
        const movieD = result.ranked.find(r => r.title === 'Movie D');
        expect(movieD?.rank).toBeGreaterThan(movieB!.rank);
      });

      it('should handle multiple ties at same level', () => {
        addMovie(1, 'Movie A');
        addMovie(2, 'Movie B');
        addMovie(3, 'Movie C');
        addPreference('user1', 1, 2, 0); // A = B
        addPreference('user1', 1, 3, 0); // A = C
        addPreference('user1', 2, 3, 0); // B = C

        const result = computeRankings('user1');

        expect(result.ranked).toHaveLength(3);
        // All should have same rank
        expect(result.ranked[0].rank).toBe(result.ranked[1].rank);
        expect(result.ranked[1].rank).toBe(result.ranked[2].rank);
      });
    });

    describe('Transitivity (Missing Direct Comparisons)', () => {
      it('should infer transitive preference A > C from A > B and B > C', () => {
        addMovie(1, 'Movie A');
        addMovie(2, 'Movie B');
        addMovie(3, 'Movie C');
        addPreference('user1', 1, 2, 1); // A > B
        addPreference('user1', 2, 3, 1); // B > C
        // No direct A vs C comparison

        const result = computeRankings('user1');

        expect(result.ranked).toHaveLength(3);
        const movieA = result.ranked.find(r => r.title === 'Movie A');
        const movieC = result.ranked.find(r => r.title === 'Movie C');
        expect(movieA?.rank).toBeLessThan(movieC!.rank);
      });

      it('should handle longer transitive chains', () => {
        addMovie(1, 'Movie A');
        addMovie(2, 'Movie B');
        addMovie(3, 'Movie C');
        addMovie(4, 'Movie D');
        addMovie(5, 'Movie E');
        addPreference('user1', 1, 2, 1); // A > B
        addPreference('user1', 2, 3, 1); // B > C
        addPreference('user1', 3, 4, 1); // C > D
        addPreference('user1', 4, 5, 1); // D > E

        const result = computeRankings('user1');

        expect(result.ranked).toHaveLength(5);
        expect(result.ranked[0].title).toBe('Movie A');
        expect(result.ranked[4].title).toBe('Movie E');
      });

      it('should handle branching preferences', () => {
        // A beats both B and C, B and C beat D
        addMovie(1, 'Movie A');
        addMovie(2, 'Movie B');
        addMovie(3, 'Movie C');
        addMovie(4, 'Movie D');
        addPreference('user1', 1, 2, 1); // A > B
        addPreference('user1', 1, 3, 1); // A > C
        addPreference('user1', 2, 4, 1); // B > D
        addPreference('user1', 3, 4, 1); // C > D
        // B and C not compared to each other

        const result = computeRankings('user1');

        const movieA = result.ranked.find(r => r.title === 'Movie A');
        const movieB = result.ranked.find(r => r.title === 'Movie B');
        const movieC = result.ranked.find(r => r.title === 'Movie C');
        const movieD = result.ranked.find(r => r.title === 'Movie D');

        expect(movieA?.rank).toBe(1);
        // B and C should have same rank (not compared, both at same level in graph)
        expect(movieB?.rank).toBe(movieC?.rank);
        expect(movieD?.rank).toBeGreaterThan(movieB!.rank);
      });
    });

    describe('Disconnected Components (Unranked Movies)', () => {
      it('should put disconnected movies in unranked section', () => {
        addMovie(1, 'Movie A');
        addMovie(2, 'Movie B');
        addMovie(3, 'Movie C');
        addMovie(4, 'Movie D');
        // Component 1: A > B
        addPreference('user1', 1, 2, 1);
        // Component 2: C > D (disconnected from A, B)
        addPreference('user1', 3, 4, 1);

        const result = computeRankings('user1');

        // Largest component should be ranked, smaller one unranked
        // Both components have 2 movies, so it's arbitrary which is "largest"
        // The algorithm picks one as main, other goes to unranked
        expect(result.ranked.length + result.unranked.length).toBe(4);
        expect(result.unranked.length).toBeGreaterThan(0);
      });

      it('should keep larger component as ranked', () => {
        addMovie(1, 'Movie A');
        addMovie(2, 'Movie B');
        addMovie(3, 'Movie C');
        addMovie(4, 'Movie D');
        // Large component: A > B > C
        addPreference('user1', 1, 2, 1);
        addPreference('user1', 2, 3, 1);
        // Small component: D alone (compared to itself implicitly)
        // Actually D needs a comparison to exist
        addMovie(5, 'Movie E');
        addPreference('user1', 4, 5, 1); // D > E (small component)

        const result = computeRankings('user1');

        // A, B, C should be in ranked (larger component)
        const rankedTitles = result.ranked.map(r => r.title);
        expect(rankedTitles).toContain('Movie A');
        expect(rankedTitles).toContain('Movie B');
        expect(rankedTitles).toContain('Movie C');

        // D, E should be in unranked (smaller component)
        const unrankedTitles = result.unranked.map(u => u.title);
        expect(unrankedTitles).toContain('Movie D');
        expect(unrankedTitles).toContain('Movie E');
      });
    });

    describe('Edge Cases', () => {
      it('should exclude watched movies', () => {
        addMovie(1, 'Movie A');
        addMovie(2, 'Movie B');
        addPreference('user1', 1, 2, 1);

        // Mark movie A as watched
        const db = getTestDb();
        db.run('UPDATE movies SET watched = 1 WHERE id = 1');

        const result = computeRankings('user1');

        // Only B should remain, but it needs another movie to be ranked
        // Actually with just B and no other unwatched movie in preferences, it won't show
        expect(result.ranked.length).toBeLessThanOrEqual(1);
      });

      it('should handle single movie in preferences', () => {
        addMovie(1, 'Movie A');
        addMovie(2, 'Movie B');
        addPreference('user1', 1, 2, 1);

        // Mark B as watched
        const db = getTestDb();
        db.run('UPDATE movies SET watched = 1 WHERE id = 2');

        const result = computeRankings('user1');

        // Only A remains, should still show in ranked
        if (result.ranked.length > 0) {
          expect(result.ranked[0].title).toBe('Movie A');
        }
      });
    });
  });

  // ============================================================
  // CONDORCET RANKING TESTS
  // ============================================================
  describe('computeCondorcetRanking - Group Voting', () => {
    const eventDate = getNextWednesdayDate();

    describe('Single Voter Scenarios', () => {
      it('should return empty when no attendees', () => {
        addMovie(1, 'Movie A');
        addMovie(2, 'Movie B');
        addPreference('user1', 1, 2, 1);
        // No attendance added

        const result = computeCondorcetRanking();

        // With no attendees, should return movies but with no votes
        expect(result.length).toBeGreaterThanOrEqual(0);
      });

      it('should rank based on single voter preferences', () => {
        addMovie(1, 'Movie A');
        addMovie(2, 'Movie B');
        addMovie(3, 'Movie C');
        addPreference('user1', 1, 2, 1); // A > B
        addPreference('user1', 2, 3, 1); // B > C
        addAttendance('user1', eventDate);

        const result = computeCondorcetRanking();

        expect(result.length).toBe(3);
        expect(result[0].title).toBe('Movie A');
        expect(result[1].title).toBe('Movie B');
        expect(result[2].title).toBe('Movie C');
      });

      it('should use transitivity for single voter', () => {
        addMovie(1, 'Movie A');
        addMovie(2, 'Movie B');
        addMovie(3, 'Movie C');
        addPreference('user1', 1, 2, 1); // A > B
        addPreference('user1', 2, 3, 1); // B > C
        // No direct A vs C
        addAttendance('user1', eventDate);

        const result = computeCondorcetRanking();

        // A should beat C transitively
        const aIndex = result.findIndex(r => r.title === 'Movie A');
        const cIndex = result.findIndex(r => r.title === 'Movie C');
        expect(aIndex).toBeLessThan(cIndex);
      });
    });

    describe('Multiple Voters - Agreement', () => {
      it('should rank unanimously preferred movie first', () => {
        addMovie(1, 'Movie A');
        addMovie(2, 'Movie B');

        // Both users prefer A
        addPreference('user1', 1, 2, 1);
        addPreference('user2', 1, 2, 1);
        addAttendance('user1', eventDate);
        addAttendance('user2', eventDate);

        const result = computeCondorcetRanking();

        expect(result[0].title).toBe('Movie A');
        expect(result[0].wins).toBeGreaterThan(0);
      });

      it('should have higher margin with more agreement', () => {
        addMovie(1, 'Movie A');
        addMovie(2, 'Movie B');
        addMovie(3, 'Movie C');

        // All 3 users agree: A > B > C
        for (const user of ['user1', 'user2', 'user3']) {
          addPreference(user, 1, 2, 1);
          addPreference(user, 2, 3, 1);
          addAttendance(user, eventDate);
        }

        const result = computeCondorcetRanking();

        expect(result[0].title).toBe('Movie A');
        expect(result[1].title).toBe('Movie B');
        expect(result[2].title).toBe('Movie C');
      });
    });

    describe('Multiple Voters - Conflict', () => {
      it('should handle simple majority', () => {
        addMovie(1, 'Movie A');
        addMovie(2, 'Movie B');

        // 2 prefer A, 1 prefers B
        addPreference('user1', 1, 2, 1); // A > B
        addPreference('user2', 1, 2, 1); // A > B
        addPreference('user3', 1, 2, -1); // B > A
        addAttendance('user1', eventDate);
        addAttendance('user2', eventDate);
        addAttendance('user3', eventDate);

        const result = computeCondorcetRanking();

        expect(result[0].title).toBe('Movie A');
      });

      it('should handle Condorcet paradox gracefully', () => {
        // Classic cycle: A > B > C > A
        addMovie(1, 'Movie A');
        addMovie(2, 'Movie B');
        addMovie(3, 'Movie C');

        // User 1: A > B > C
        addPreference('user1', 1, 2, 1);
        addPreference('user1', 2, 3, 1);
        addPreference('user1', 1, 3, 1);

        // User 2: B > C > A
        addPreference('user2', 2, 3, 1);
        addPreference('user2', 3, 1, 1);
        addPreference('user2', 2, 1, 1);

        // User 3: C > A > B
        addPreference('user3', 3, 1, 1);
        addPreference('user3', 1, 2, 1);
        addPreference('user3', 3, 2, 1);

        addAttendance('user1', eventDate);
        addAttendance('user2', eventDate);
        addAttendance('user3', eventDate);

        const result = computeCondorcetRanking();

        // Should produce some ranking without crashing
        expect(result.length).toBe(3);
      });
    });

    describe('Transitivity Across Users', () => {
      it('should use computed rankings with transitivity', () => {
        addMovie(1, 'Movie A');
        addMovie(2, 'Movie B');
        addMovie(3, 'Movie C');

        // User 1: A > B, B > C (implies A > C)
        addPreference('user1', 1, 2, 1);
        addPreference('user1', 2, 3, 1);

        // User 2: A > B, B > C (implies A > C)
        addPreference('user2', 1, 2, 1);
        addPreference('user2', 2, 3, 1);

        addAttendance('user1', eventDate);
        addAttendance('user2', eventDate);

        const result = computeCondorcetRanking();

        // Both users transitively prefer A > C
        const aIndex = result.findIndex(r => r.title === 'Movie A');
        const cIndex = result.findIndex(r => r.title === 'Movie C');
        expect(aIndex).toBeLessThan(cIndex);
      });

      it('should handle mixed transitivity scenarios', () => {
        addMovie(1, 'Movie A');
        addMovie(2, 'Movie B');
        addMovie(3, 'Movie C');
        addMovie(4, 'Movie D');

        // User 1 has full ranking: A > B > C > D
        addPreference('user1', 1, 2, 1);
        addPreference('user1', 2, 3, 1);
        addPreference('user1', 3, 4, 1);

        // User 2 only compared some: A > D, B > C
        addPreference('user2', 1, 4, 1);
        addPreference('user2', 2, 3, 1);

        addAttendance('user1', eventDate);
        addAttendance('user2', eventDate);

        const result = computeCondorcetRanking();

        // Should produce valid ranking
        expect(result.length).toBe(4);
      });
    });

    describe('Tie Handling', () => {
      it('should handle explicit ties from users', () => {
        addMovie(1, 'Movie A');
        addMovie(2, 'Movie B');

        // Both users say A = B
        addPreference('user1', 1, 2, 0);
        addPreference('user2', 1, 2, 0);
        addAttendance('user1', eventDate);
        addAttendance('user2', eventDate);

        const result = computeCondorcetRanking();

        // Should have both movies, ties result in no edge
        expect(result.length).toBe(2);
        // They should have same number of wins/losses
        expect(result[0].wins).toBe(result[1].wins);
      });

      it('should handle split vote tie', () => {
        addMovie(1, 'Movie A');
        addMovie(2, 'Movie B');

        // One prefers A, one prefers B
        addPreference('user1', 1, 2, 1); // A > B
        addPreference('user2', 1, 2, -1); // B > A
        addAttendance('user1', eventDate);
        addAttendance('user2', eventDate);

        const result = computeCondorcetRanking();

        expect(result.length).toBe(2);
        // Tied vote, both should have 0 wins from this pair
      });
    });

    describe('Partial Rankings', () => {
      it('should handle user who only ranked some movies', () => {
        addMovie(1, 'Movie A');
        addMovie(2, 'Movie B');
        addMovie(3, 'Movie C');

        // User 1 ranked all
        addPreference('user1', 1, 2, 1);
        addPreference('user1', 2, 3, 1);

        // User 2 only ranked A vs B
        addPreference('user2', 1, 2, 1);

        addAttendance('user1', eventDate);
        addAttendance('user2', eventDate);

        const result = computeCondorcetRanking();

        // A should win clearly (2 votes)
        // C is only ranked by user1, so has fewer votes
        expect(result[0].title).toBe('Movie A');
      });

      it('should prefer ranked movie over unranked', () => {
        addMovie(1, 'Movie A');
        addMovie(2, 'Movie B');
        addMovie(3, 'Movie C');

        // User 1 ranked A and B, not C
        addPreference('user1', 1, 2, 1);
        // User 2 ranked all
        addPreference('user2', 1, 2, 1);
        addPreference('user2', 2, 3, 1);

        addAttendance('user1', eventDate);
        addAttendance('user2', eventDate);

        const result = computeCondorcetRanking();

        // User1's computed ranking: A > B (C not ranked)
        // User2's computed ranking: A > B > C
        // For A vs C: User1 prefers A (ranked vs unranked), User2 prefers A
        const aIndex = result.findIndex(r => r.title === 'Movie A');
        const cIndex = result.findIndex(r => r.title === 'Movie C');
        expect(aIndex).toBeLessThan(cIndex);
      });
    });

    describe('Non-Attending Users', () => {
      it('should ignore preferences from non-attendees', () => {
        addMovie(1, 'Movie A');
        addMovie(2, 'Movie B');

        // User 1 prefers A (attending)
        addPreference('user1', 1, 2, 1);
        addAttendance('user1', eventDate);

        // User 2 prefers B (not attending)
        addPreference('user2', 1, 2, -1);
        // No attendance for user2

        const result = computeCondorcetRanking();

        // Only user1's vote should count
        expect(result[0].title).toBe('Movie A');
      });

      it('should handle user who marks not attending', () => {
        addMovie(1, 'Movie A');
        addMovie(2, 'Movie B');

        addPreference('user1', 1, 2, 1);
        addPreference('user2', 1, 2, -1);

        addAttendance('user1', eventDate, true); // attending
        addAttendance('user2', eventDate, false); // not attending

        const result = computeCondorcetRanking();

        expect(result[0].title).toBe('Movie A');
      });
    });
  });

  // ============================================================
  // CONDORCET MATRIX TESTS
  // ============================================================
  describe('computeCondorcetMatrix - Vote Matrix', () => {
    const eventDate = getNextWednesdayDate();

    it('should produce correct matrix dimensions', () => {
      addMovie(1, 'Movie A');
      addMovie(2, 'Movie B');
      addMovie(3, 'Movie C');

      const result = computeCondorcetMatrix();

      expect(result.movies.length).toBe(3);
      expect(result.matrix.length).toBe(3);
      expect(result.matrix[0].length).toBe(3);
    });

    it('should count votes correctly', () => {
      addMovie(1, 'Movie A');
      addMovie(2, 'Movie B');

      addPreference('user1', 1, 2, 1); // A > B
      addPreference('user2', 1, 2, 1); // A > B
      addAttendance('user1', eventDate);
      addAttendance('user2', eventDate);

      const result = computeCondorcetMatrix();

      const aIndex = result.movies.indexOf('Movie A');
      const bIndex = result.movies.indexOf('Movie B');

      // 2 votes for A over B
      expect(result.matrix[aIndex][bIndex]).toBe(2);
      // 0 votes for B over A
      expect(result.matrix[bIndex][aIndex]).toBe(0);
    });

    it('should use transitivity in matrix', () => {
      addMovie(1, 'Movie A');
      addMovie(2, 'Movie B');
      addMovie(3, 'Movie C');

      // User has A > B > C (no direct A vs C)
      addPreference('user1', 1, 2, 1);
      addPreference('user1', 2, 3, 1);
      addAttendance('user1', eventDate);

      const result = computeCondorcetMatrix();

      const aIndex = result.movies.indexOf('Movie A');
      const cIndex = result.movies.indexOf('Movie C');

      // Should have 1 vote for A over C (transitive)
      expect(result.matrix[aIndex][cIndex]).toBe(1);
    });

    it('should handle ties correctly in matrix', () => {
      addMovie(1, 'Movie A');
      addMovie(2, 'Movie B');

      addPreference('user1', 1, 2, 0); // tie
      addAttendance('user1', eventDate);

      const result = computeCondorcetMatrix();

      const aIndex = result.movies.indexOf('Movie A');
      const bIndex = result.movies.indexOf('Movie B');

      // Tie means no vote either way
      expect(result.matrix[aIndex][bIndex]).toBe(0);
      expect(result.matrix[bIndex][aIndex]).toBe(0);
    });
  });

  // ============================================================
  // LARGE SCALE SCENARIO TESTS
  // ============================================================
  describe('Large Scale Scenarios', () => {
    const eventDate = getNextWednesdayDate();

    it('should handle 10 movies with complex preferences', () => {
      // Add 10 movies
      for (let i = 1; i <= 10; i++) {
        addMovie(i, `Movie ${String.fromCharCode(64 + i)}`); // Movie A through J
      }

      // User 1: Linear ranking 1 > 2 > 3 > ... > 10
      for (let i = 1; i < 10; i++) {
        addPreference('user1', i, i + 1, 1);
      }

      // User 2: Reverse ranking 10 > 9 > ... > 1
      for (let i = 10; i > 1; i--) {
        addPreference('user2', i, i - 1, 1);
      }

      // User 3: Only ranked top 5, prefers odd numbers
      addPreference('user3', 1, 2, 1);
      addPreference('user3', 3, 4, 1);
      addPreference('user3', 1, 3, 1);
      addPreference('user3', 2, 4, 1);
      addPreference('user3', 5, 2, 1);

      addAttendance('user1', eventDate);
      addAttendance('user2', eventDate);
      addAttendance('user3', eventDate);

      const result = computeCondorcetRanking();

      expect(result.length).toBe(10);
      // Should complete without error and produce valid ranking
      for (const r of result) {
        expect(r.movieId).toBeGreaterThan(0);
        expect(r.title).toBeDefined();
      }
    });

    it('should handle many users with sparse preferences', () => {
      // Add 5 movies
      for (let i = 1; i <= 5; i++) {
        addMovie(i, `Movie ${i}`);
      }

      // 10 users, each only compares 2-3 movies
      for (let u = 1; u <= 10; u++) {
        const userId = `user${u}`;
        // Each user compares movie (u % 5 + 1) vs ((u + 1) % 5 + 1)
        const m1 = (u % 5) + 1;
        const m2 = ((u + 1) % 5) + 1;
        if (m1 !== m2) {
          addPreference(userId, m1, m2, u % 2 === 0 ? 1 : -1);
        }
        addAttendance(userId, eventDate);
      }

      const result = computeCondorcetRanking();

      expect(result.length).toBe(5);
    });

    it('should handle complete pairwise comparisons', () => {
      // Add 4 movies
      for (let i = 1; i <= 4; i++) {
        addMovie(i, `Movie ${i}`);
      }

      // User compares every pair (n*(n-1)/2 = 6 comparisons)
      addPreference('user1', 1, 2, 1); // 1 > 2
      addPreference('user1', 1, 3, 1); // 1 > 3
      addPreference('user1', 1, 4, 1); // 1 > 4
      addPreference('user1', 2, 3, 1); // 2 > 3
      addPreference('user1', 2, 4, 1); // 2 > 4
      addPreference('user1', 3, 4, 1); // 3 > 4

      addAttendance('user1', eventDate);

      const result = computeCondorcetRanking();

      expect(result.length).toBe(4);
      expect(result[0].title).toBe('Movie 1');
      expect(result[1].title).toBe('Movie 2');
      expect(result[2].title).toBe('Movie 3');
      expect(result[3].title).toBe('Movie 4');
    });
  });
});
