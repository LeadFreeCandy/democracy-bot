import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
} from 'discord.js';
import { computeRankings, getUnrankedMovies, movies } from '../database/queries';

export const RankingsButtonIds = {
  RANK_MOVIES: 'rankings_rank_movies',
  REFRESH: 'rankings_refresh',
  CLEAR_RANKINGS: 'rankings_clear',
  CONFIRM_CLEAR: 'rankings_confirm_clear',
  CANCEL: 'rankings_cancel',
} as const;

export const RankingsSelectIds = {
  RERANK_MOVIE: 'rankings_rerank_movie',
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

export function buildRerankMovieSelect(userId: string): ActionRowBuilder<StringSelectMenuBuilder> | null {
  const { ranked } = computeRankings(userId);

  if (ranked.length === 0) {
    return null;
  }

  const options = ranked.slice(0, 25).map(m =>
    new StringSelectMenuOptionBuilder()
      .setLabel(m.title.slice(0, 100))
      .setDescription(`Currently ranked #${m.rank}`)
      .setValue(m.movieId.toString())
  );

  const select = new StringSelectMenuBuilder()
    .setCustomId(`${RankingsSelectIds.RERANK_MOVIE}:${userId}`)
    .setPlaceholder('Select a movie to rerank...')
    .addOptions(options);

  return new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(select);
}

export function buildUserRankingsButtons(userId: string): ActionRowBuilder<ButtonBuilder> {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(`${RankingsButtonIds.RANK_MOVIES}:${userId}`)
      .setLabel('Rank Movies')
      .setStyle(ButtonStyle.Primary)
      .setEmoji('🗳️'),
    new ButtonBuilder()
      .setCustomId(`${RankingsButtonIds.CLEAR_RANKINGS}:${userId}`)
      .setLabel('Clear My Rankings')
      .setStyle(ButtonStyle.Danger)
      .setEmoji('🗑️'),
    new ButtonBuilder()
      .setCustomId(`${RankingsButtonIds.REFRESH}:${userId}`)
      .setLabel('Refresh')
      .setStyle(ButtonStyle.Secondary)
      .setEmoji('🔄'),
  );
}

export function buildUserRankingsMessage(userId: string) {
  const components: ActionRowBuilder<ButtonBuilder | StringSelectMenuBuilder>[] = [];

  const selectRow = buildRerankMovieSelect(userId);
  if (selectRow) {
    components.push(selectRow);
  }

  components.push(buildUserRankingsButtons(userId));

  return {
    embeds: [buildUserRankingsEmbed(userId)],
    components,
    ephemeral: true,
  };
}

// Confirm clear rankings dialog
export function buildConfirmClearRankingsEmbed(): EmbedBuilder {
  return new EmbedBuilder()
    .setTitle('Clear Your Rankings')
    .setDescription(
      '**Are you sure you want to clear all your rankings?**\n\n' +
      'This will delete all your movie comparisons.\n\n' +
      '**This cannot be undone!**'
    )
    .setColor(0xed4245);
}

export function buildConfirmClearRankingsButtons(userId: string): ActionRowBuilder<ButtonBuilder> {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(`${RankingsButtonIds.CONFIRM_CLEAR}:${userId}`)
      .setLabel('Yes, Clear All')
      .setStyle(ButtonStyle.Danger),
    new ButtonBuilder()
      .setCustomId(`${RankingsButtonIds.CANCEL}:${userId}`)
      .setLabel('Cancel')
      .setStyle(ButtonStyle.Secondary),
  );
}

export function buildConfirmClearRankingsMessage(userId: string) {
  return {
    embeds: [buildConfirmClearRankingsEmbed()],
    components: [buildConfirmClearRankingsButtons(userId)],
  };
}
