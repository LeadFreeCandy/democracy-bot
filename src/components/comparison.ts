import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
} from 'discord.js';
import type { RankingSession } from '../ranking/session';
import { movies } from '../database/queries';

export const ComparisonButtonIds = {
  PREFER_A: 'comparison_prefer_a',
  PREFER_B: 'comparison_prefer_b',
  NO_PREFERENCE: 'comparison_no_preference',
  CANCEL: 'comparison_cancel',
} as const;

export function buildComparisonEmbed(
  session: RankingSession,
  movieATitle: string,
  movieBTitle: string
): EmbedBuilder {
  const totalComparisons = estimateTotalComparisons(session);
  const currentComparison = session.comparisonCount + 1;
  const moviesRemaining = session.pendingMovies.length + 1;

  return new EmbedBuilder()
    .setTitle(`🗳️ Rank Your Movies`)
    .setDescription(
      `**Which do you prefer?**\n\n` +
      `> **A.** ${movieATitle}\n` +
      `> **B.** ${movieBTitle}\n\n` +
      `Comparison ${currentComparison} of ~${totalComparisons} · ${moviesRemaining} movie${moviesRemaining === 1 ? '' : 's'} left`
    )
    .setColor(0x5865f2);
}

export function buildComparisonButtons(
  movieATitle: string,
  movieBTitle: string,
  userId: string
): ActionRowBuilder<ButtonBuilder>[] {
  const row1 = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(`${ComparisonButtonIds.PREFER_A}:${userId}`)
      .setLabel(truncateLabel(movieATitle))
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId(`${ComparisonButtonIds.PREFER_B}:${userId}`)
      .setLabel(truncateLabel(movieBTitle))
      .setStyle(ButtonStyle.Primary),
  );

  const row2 = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(`${ComparisonButtonIds.NO_PREFERENCE}:${userId}`)
      .setLabel('No Preference')
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(`${ComparisonButtonIds.CANCEL}:${userId}`)
      .setLabel('Cancel')
      .setStyle(ButtonStyle.Secondary),
  );

  return [row1, row2];
}

export function buildComparisonMessage(session: RankingSession) {
  // Validate session state before building comparison
  if (!session.movieToInsert || session.sortedList.length === 0) {
    throw new Error('Invalid session state for comparison: no movie to insert or empty sorted list');
  }

  if (session.currentMid < 0 || session.currentMid >= session.sortedList.length) {
    throw new Error(`Invalid currentMid: ${session.currentMid}, sortedList length: ${session.sortedList.length}`);
  }

  const movieA = movies.getById(session.movieToInsert);
  const movieB = movies.getById(session.sortedList[session.currentMid]);

  if (!movieA || !movieB) {
    throw new Error(`Movie not found in comparison: A=${session.movieToInsert}, B=${session.sortedList[session.currentMid]}`);
  }

  return {
    embeds: [buildComparisonEmbed(session, movieA.title, movieB.title)],
    components: buildComparisonButtons(movieA.title, movieB.title, session.userId),
  };
}

export function buildCompletionEmbed(rankedCount: number): EmbedBuilder {
  return new EmbedBuilder()
    .setTitle(`✅ Rankings Updated!`)
    .setDescription(
      rankedCount === 0
        ? `No new movies to rank.`
        : `You ranked ${rankedCount} movie${rankedCount === 1 ? '' : 's'}.\nYour votes have been recorded.`
    )
    .setColor(0x57f287);
}

export function buildCompletionMessage(rankedCount: number) {
  return {
    embeds: [buildCompletionEmbed(rankedCount)],
    components: [],
  };
}

export function buildCancelledEmbed(): EmbedBuilder {
  return new EmbedBuilder()
    .setTitle(`⏹️ Session Cancelled`)
    .setDescription('Your progress has been saved. You can continue later.')
    .setColor(0x99aab5);
}

export function buildCancelledMessage() {
  return {
    embeds: [buildCancelledEmbed()],
    components: [],
  };
}

function truncateLabel(label: string, maxLength: number = 80): string {
  if (label.length <= maxLength) return label;
  return label.slice(0, maxLength - 3) + '...';
}

function estimateTotalComparisons(session: RankingSession): number {
  const pendingCount = session.pendingMovies.length + 1;
  const currentListSize = session.sortedList.length;
  let total = 0;
  for (let i = 0; i < pendingCount; i++) {
    total += Math.ceil(Math.log2(currentListSize + i + 1));
  }
  return Math.max(total, 1);
}
