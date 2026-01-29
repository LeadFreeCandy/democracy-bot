import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
} from 'discord.js';
import { computeCondorcetRanking } from '../database/queries';

export const ButtonIds = {
  SUBMIT_MOVIE: 'submit_movie',
  RANK_MOVIES: 'rank_movies',
  MY_RANKINGS: 'my_rankings',
  EDIT: 'edit',
} as const;

export function buildQueueEmbed(): EmbedBuilder {
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

  return new EmbedBuilder()
    .setTitle('🎬 Movie Queue')
    .setDescription(queueList)
    .setColor(0x5865f2)
    .setFooter({ text: `${rankings.length} movie${rankings.length === 1 ? '' : 's'} · Ranked by attendee votes` });
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
      .setCustomId(ButtonIds.EDIT)
      .setLabel('Edit')
      .setStyle(ButtonStyle.Secondary)
      .setEmoji('⚙️'),
  );

  return [row];
}

export function buildControlPanelMessage() {
  return {
    embeds: [buildQueueEmbed()],
    components: buildControlPanelButtons(),
  };
}
