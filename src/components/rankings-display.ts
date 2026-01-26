import { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } from 'discord.js';
import { computeRankings, responses } from '../database/queries';

export const RankingsButtonIds = {
  RANK_MOVIES: 'rankings_rank_movies',
  REFRESH: 'rankings_refresh',
} as const;

export function buildUserRankingsEmbed(userId: string): EmbedBuilder {
  const rankings = computeRankings(userId);
  const unrankedCount = responses.getMoviesToRank(userId).length - rankings.length;

  if (rankings.length === 0) {
    return new EmbedBuilder()
      .setTitle('📊 Your Rankings')
      .setDescription('You haven\'t ranked any movies yet.')
      .setColor(0x5865f2);
  }

  const rankingsList = rankings
    .map((r, i) => `**${i + 1}.** ${r.title}`)
    .join('\n');

  const footer = unrankedCount > 0
    ? `${rankings.length} ranked · ${unrankedCount} still to rank`
    : `${rankings.length} movies ranked`;

  return new EmbedBuilder()
    .setTitle('📊 Your Rankings')
    .setDescription(rankingsList)
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
