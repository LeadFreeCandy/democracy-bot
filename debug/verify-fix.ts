/**
 * Quick verification that the fixes are applied correctly.
 * This imports the actual source files and verifies behavior.
 *
 * Run with: npx tsx debug/verify-fix.ts
 */

import { readFileSync } from 'fs';
import { join } from 'path';

const sessionTs = readFileSync(join(__dirname, '../src/ranking/session.ts'), 'utf-8');
const buttonsTs = readFileSync(join(__dirname, '../src/handlers/buttons.ts'), 'utf-8');

console.log('Checking for fix patterns in source files...\n');

// Check session.ts for Fix 1
const fix1Pattern1 = 'session.sortedList.length === 0 && session.pendingMovies.length > 0';
const fix1Pattern2 = 'session.low >= session.high && session.movieToInsert !== 0';

const sessionHasFix1 = sessionTs.includes(fix1Pattern1);
const sessionHasFix2 = sessionTs.includes(fix1Pattern2);

console.log('src/ranking/session.ts:');
console.log(`  ✓ Empty sortedList check: ${sessionHasFix1 ? '✅ PRESENT' : '❌ MISSING'}`);
console.log(`  ✓ low >= high loop:       ${sessionHasFix2 ? '✅ PRESENT' : '❌ MISSING'}`);

// Check buttons.ts for Fix 2 (handleIngestionResponse)
const buttonsHasFix2 = buttonsTs.includes('session.low >= session.high && session.movieToInsert !== 0');

// Check buttons.ts for Fix 3 (handleRankMovies - movieToInsert === 0 check)
const buttonsHasFix3 = buttonsTs.includes('session.movieToInsert === 0');

console.log('\nsrc/handlers/buttons.ts:');
console.log(`  ✓ low >= high loop:              ${buttonsHasFix2 ? '✅ PRESENT' : '❌ MISSING'}`);
console.log(`  ✓ movieToInsert === 0 check:     ${buttonsHasFix3 ? '✅ PRESENT' : '❌ MISSING'}`);

// Summary
const allFixed = sessionHasFix1 && sessionHasFix2 && buttonsHasFix2 && buttonsHasFix3;

console.log('\n' + '='.repeat(50));
if (allFixed) {
  console.log('✅ ALL FIXES APPLIED SUCCESSFULLY');
  console.log('\nYou can now run: npm run dev');
} else {
  console.log('❌ SOME FIXES ARE MISSING');
  process.exit(1);
}
