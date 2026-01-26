/**
 * COMPLETE FIX INSTRUCTIONS
 * Run: npx tsx debug/apply-fix.ts
 *
 * Tests:
 *   npx tsx debug/test-session.ts  # Shows 6 failing tests (current bugs)
 *   npx tsx debug/fix-session.ts   # Shows 9 passing tests (with fixes)
 */

console.log(`
================================================================================
                            COMPLETE FIX INSTRUCTIONS
================================================================================

There are TWO locations that need to be fixed:

================================================================================
FIX 1: src/ranking/session.ts - setupRankingPhase()
================================================================================

In setupRankingPhase(), after line 98 (session.pendingMovies = [...]), add:

  // FIX: When sortedList is empty, first movie goes directly in
  if (session.sortedList.length === 0 && session.pendingMovies.length > 0) {
    const firstMovie = session.pendingMovies.shift()!;
    session.sortedList = [firstMovie];
    session.moviesRankedThisSession = 1;
  }

Then change the existing block (lines 100-111) to handle low >= high:

  if (session.pendingMovies.length > 0) {
    const firstMovie = session.pendingMovies.shift()!;
    session.movieToInsert = firstMovie;
    session.low = 0;
    const movieResponse = responses.getResponse(session.userId, firstMovie);
    if (movieResponse === 'maybe') {
      session.low = session.sortedList.length;
    }
    session.high = session.sortedList.length;

    // FIX: When low >= high, position is determined - insert directly
    while (session.low >= session.high && session.movieToInsert !== 0) {
      session.sortedList.splice(session.low, 0, session.movieToInsert);
      session.moviesRankedThisSession++;

      if (session.pendingMovies.length === 0) {
        session.movieToInsert = 0;
        break;
      }

      const nextMovie = session.pendingMovies.shift()!;
      session.movieToInsert = nextMovie;
      session.low = 0;
      const nextResponse = responses.getResponse(session.userId, nextMovie);
      if (nextResponse === 'maybe') {
        session.low = session.sortedList.length;
      }
      session.high = session.sortedList.length;
    }

    session.currentMid = Math.floor((session.low + session.high) / 2);
  }


================================================================================
FIX 2: src/handlers/buttons.ts - handleIngestionResponse()
================================================================================

In handleIngestionResponse(), after the block that inserts the first movie
(around line 374), add the same low >= high handling:

Replace lines 366-375:

    // Set up next movie for comparison
    session.movieToInsert = session.pendingMovies.shift()!;
    session.low = 0;
    const movieResponse = responses.getResponse(userId, session.movieToInsert);
    if (movieResponse === 'maybe') {
      session.low = session.sortedList.length;
    }
    session.high = session.sortedList.length;
    session.currentMid = Math.floor((session.low + session.high) / 2);

With:

    // Set up next movie for comparison
    session.movieToInsert = session.pendingMovies.shift()!;
    session.low = 0;
    const movieResponse = responses.getResponse(userId, session.movieToInsert);
    if (movieResponse === 'maybe') {
      session.low = session.sortedList.length;
    }
    session.high = session.sortedList.length;

    // FIX: When low >= high, position is determined - insert directly
    while (session.low >= session.high && session.movieToInsert !== 0) {
      session.sortedList.splice(session.low, 0, session.movieToInsert);
      session.moviesRankedThisSession++;

      if (session.pendingMovies.length === 0) {
        session.movieToInsert = 0;
        await interaction.update(buildCompletionMessage(session.moviesRankedThisSession, username));
        scheduleDelete(interaction.message as Message);
        deleteSession(userId);
        return;
      }

      const nextMovie = session.pendingMovies.shift()!;
      session.movieToInsert = nextMovie;
      session.low = 0;
      const nextResponse = responses.getResponse(userId, nextMovie);
      if (nextResponse === 'maybe') {
        session.low = session.sortedList.length;
      }
      session.high = session.sortedList.length;
    }

    session.currentMid = Math.floor((session.low + session.high) / 2);


================================================================================
ROOT CAUSE EXPLANATION
================================================================================

The binary insertion algorithm compares movieToInsert against sortedList[currentMid].

BUG 1: When sortedList is empty (no previous rankings), there's nothing to
       compare against. The first movie must be inserted directly.

BUG 2: When a "maybe" movie is set up for comparison:
       - low = sortedList.length (e.g., 1 for a 1-element list)
       - high = sortedList.length (e.g., 1)
       - currentMid = floor((1+1)/2) = 1
       - But sortedList[1] is OUT OF BOUNDS when length is 1!

       When low >= high, the position is already determined (at index 'low').
       No comparison is needed - just insert directly.

================================================================================
`);
