import { Client, TextChannel } from 'discord.js';
import { execFile } from 'child_process';
import * as path from 'path';
import * as fs from 'fs';
import {
  getVote,
  getVoteOptions,
  getVoterIds,
  getActiveVotes,
  completeVote,
  computeVoteResults,
  getWinnerExplanation,
} from './database';
import { buildVotePanelMessage, buildVoteResultsMessage } from './components';

const activeTimers = new Map<number, NodeJS.Timeout>();

export function scheduleVoteExpiration(voteId: number, endsAt: number, client: Client): void {
  // Clear existing timer if any
  const existing = activeTimers.get(voteId);
  if (existing) clearTimeout(existing);

  const delay = Math.max(endsAt - Date.now(), 0);

  const timer = setTimeout(() => {
    activeTimers.delete(voteId);
    handleVoteExpiration(voteId, client).catch(err =>
      console.error(`Failed to handle vote ${voteId} expiration:`, err)
    );
  }, delay);

  activeTimers.set(voteId, timer);
}

async function handleVoteExpiration(voteId: number, client: Client): Promise<void> {
  const vote = getVote(voteId);
  if (!vote || vote.status !== 'active') return;

  // Mark complete
  completeVote(voteId);

  // Compute results
  const results = computeVoteResults(voteId);

  // Generate graph
  let graphBuffer: Buffer | undefined;
  try {
    graphBuffer = await generateVoteGraph(voteId);
  } catch (err) {
    console.error(`Failed to generate vote graph for vote ${voteId}:`, err);
  }

  // Post results to channel
  try {
    const channel = await client.channels.fetch(vote.channel_id);
    if (channel && channel.isTextBased()) {
      const textChannel = channel as TextChannel;
      const explanation = getWinnerExplanation(voteId);
      await textChannel.send(buildVoteResultsMessage(vote, results, graphBuffer, explanation));
    }
  } catch (err) {
    console.error(`Failed to post vote ${voteId} results:`, err);
  }

  // Update the original vote panel to show "Closed"
  try {
    if (vote.message_id) {
      const channel = await client.channels.fetch(vote.channel_id);
      if (channel && channel.isTextBased()) {
        const textChannel = channel as TextChannel;
        const message = await textChannel.messages.fetch(vote.message_id);
        const updatedVote = getVote(voteId)!;
        const options = getVoteOptions(voteId);
        const voterIds = getVoterIds(voteId);
        await message.edit(buildVotePanelMessage(updatedVote, options, voterIds));
      }
    }
  } catch {
    // Panel message may have been deleted
  }
}

export function generateVoteGraph(voteId: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const scriptPath = path.join(process.cwd(), 'visualize_vote.py');
    const dbPath = path.join(process.cwd(), 'data', 'votes.db');
    const outputPath = path.join(process.cwd(), 'data', `vote_${voteId}_graph.png`);

    execFile('python3', [scriptPath, '--db', dbPath, '--vote-id', String(voteId), '--output', outputPath], (err) => {
      if (err) {
        reject(err);
        return;
      }

      try {
        const buffer = fs.readFileSync(outputPath);
        // Clean up temp file
        fs.unlinkSync(outputPath);
        resolve(buffer);
      } catch (readErr) {
        reject(readErr);
      }
    });
  });
}

/**
 * On bot startup, restore timers for all active votes.
 * Immediately expires any votes that are past due.
 */
export function restoreVoteTimers(client: Client): void {
  const activeVotes = getActiveVotes();
  const now = Date.now();

  for (const vote of activeVotes) {
    if (vote.ends_at <= now) {
      // Past due — expire immediately
      handleVoteExpiration(vote.id, client).catch(err =>
        console.error(`Failed to expire overdue vote ${vote.id}:`, err)
      );
    } else {
      scheduleVoteExpiration(vote.id, vote.ends_at, client);
      console.log(`Restored timer for vote #${vote.id} (expires in ${Math.round((vote.ends_at - now) / 1000 / 60)}m)`);
    }
  }
}
