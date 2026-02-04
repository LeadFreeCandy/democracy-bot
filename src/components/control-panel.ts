import {
  ActionRowBuilder,
  AttachmentBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
} from 'discord.js';
import { computeCondorcetRanking } from '../database/queries';
import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

const GRAPH_OUTPUT_PATH = path.join(process.cwd(), 'data', 'condorcet_graph.png');

function generateCondorcetGraph(): Buffer | null {
  try {
    // Run the Python script to generate the graph
    execSync(`python3 visualize_condorcet.py --loose --output "${GRAPH_OUTPUT_PATH}" --quiet`, {
      cwd: process.cwd(),
      timeout: 30000,
    });

    // Read the generated image
    if (fs.existsSync(GRAPH_OUTPUT_PATH)) {
      return fs.readFileSync(GRAPH_OUTPUT_PATH);
    }
  } catch (error) {
    console.error('Failed to generate Condorcet graph:', error);
  }
  return null;
}

export const ButtonIds = {
  SUBMIT_MOVIE: 'submit_movie',
  RANK_MOVIES: 'rank_movies',
  MY_RANKINGS: 'my_rankings',
  ADMIN: 'admin',
} as const;

export function buildQueueEmbed(includeImage: boolean = false): EmbedBuilder {
  const rankings = computeCondorcetRanking();

  if (rankings.length === 0) {
    return new EmbedBuilder()
      .setTitle('🎬 Movie Queue')
      .setDescription(
        '*No movies yet!*\n\n' +
        'Submit a movie to get started.'
      )
      .setColor(0x5865f2)
      .setFooter({ text: 'Submit a movie · Rank your choices · Watch together' });
  }

  // Format: "1. Movie Title (3 ranked)"
  const queueList = rankings
    .map((r, i) => {
      const rankedBy = r.rankedByCount === 0 ? '' : ` — ${r.rankedByCount} ranked`;
      return `**${i + 1}.** ${r.title}${rankedBy}`;
    })
    .join('\n');

  const embed = new EmbedBuilder()
    .setTitle('🎬 Movie Queue')
    .setDescription(queueList)
    .setColor(0x5865f2)
    .setFooter({ text: `${rankings.length} movie${rankings.length === 1 ? '' : 's'} · Ranked by attendee votes` });

  if (includeImage) {
    embed.setImage('attachment://condorcet_graph.png');
  }

  return embed;
}

export function buildControlPanelButtons(): ActionRowBuilder<ButtonBuilder>[] {
  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(ButtonIds.SUBMIT_MOVIE)
      .setLabel('Submit Movie')
      .setStyle(ButtonStyle.Primary)
      .setEmoji('📝'),
    new ButtonBuilder()
      .setCustomId(ButtonIds.RANK_MOVIES)
      .setLabel('Rank Movies')
      .setStyle(ButtonStyle.Success)
      .setEmoji('🗳️'),
    new ButtonBuilder()
      .setCustomId(ButtonIds.MY_RANKINGS)
      .setLabel('My Rankings')
      .setStyle(ButtonStyle.Secondary)
      .setEmoji('📊'),
    new ButtonBuilder()
      .setCustomId(ButtonIds.ADMIN)
      .setLabel('Admin')
      .setStyle(ButtonStyle.Secondary)
      .setEmoji('⚙️'),
  );

  return [row];
}

export function buildControlPanelMessage(includeGraph: boolean = true) {
  const graphBuffer = includeGraph ? generateCondorcetGraph() : null;
  const files: AttachmentBuilder[] = [];

  if (graphBuffer) {
    files.push(new AttachmentBuilder(graphBuffer, { name: 'condorcet_graph.png' }));
  }

  return {
    embeds: [buildQueueEmbed(!!graphBuffer)],
    components: buildControlPanelButtons(),
    files,
  };
}
