import { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } from 'discord.js';
import { computeRankings, getUnrankedMovies } from '../database/queries';

export const RankingsButtonIds = {
  RANK_MOVIES: 'rankings_rank_movies',
  REFRESH: 'rankings_refresh',
} as const;

export function buildUserRankingsEmbed(userId: string): EmbedBuilder {
  const { ranked, unranked: partiallyRanked } = computeRankings(userId);
  const neverCompared = getUnrankedMovies(userId);

  if (ranked.length === 0 && partiallyRanked.length === 0) {
    return new EmbedBuilder()
      .setTitle('📊 Your Rankings')
      .setDescription('You haven\'t ranked any movies yet.')
      .setColor(0x5865f2);
  }

  // Build rankings list with ties shown at same number
  const lines: string[] = [];
  let lastRank = 0;
  for (const r of ranked) {
    if (r.rank === lastRank) {
      // Tied with previous - show same rank number
      lines.push(`**${r.rank}.** ${r.title}`);
    } else {
      lines.push(`**${r.rank}.** ${r.title}`);
      lastRank = r.rank;
    }
  }

  let description = lines.join('\n');

  // Add partially ranked section (movies compared but can't be ordered)
  if (partiallyRanked.length > 0) {
    description += '\n\n**Unranked:**\n';
    description += partiallyRanked.map(m => `- ${m.title}`).join('\n');
  }

  const totalRanked = ranked.length;
  const totalUnranked = partiallyRanked.length + neverCompared.length;

  const footer = totalUnranked > 0
    ? `${totalRanked} ranked · ${totalUnranked} still to rank`
    : `${totalRanked} movies ranked`;

  return new EmbedBuilder()
    .setTitle('📊 Your Rankings')
    .setDescription(description)
    .setColor(0x5865f2)
    .setFooter({ text: footer });
}

export function buildUserRankingsButtons(userId: string): ActionRowBuilder<ButtonBuilder> {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(`${RankingsButtonIds.RANK_MOVIES}:${userId}`)
      .setLabel('Rank Movies')
      .setStyle(ButtonStyle.Primary)
      .setEmoji('🗳️'),
    new ButtonBuilder()
      .setCustomId(`${RankingsButtonIds.REFRESH}:${userId}`)
      .setLabel('Refresh')
      .setStyle(ButtonStyle.Secondary)
      .setEmoji('🔄'),
  );
}

export function buildUserRankingsMessage(userId: string) {
  return {
    embeds: [buildUserRankingsEmbed(userId)],
    components: [buildUserRankingsButtons(userId)],
    ephemeral: true,
  };
}
