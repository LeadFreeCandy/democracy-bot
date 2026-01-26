import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
} from 'discord.js';
import type { RankingSession } from '../ranking/session';
import { movies } from '../database/queries';

export const IngestionButtonIds = {
  YES: 'ingestion_yes',
  NO: 'ingestion_no',
  CANCEL: 'ingestion_cancel',
} as const;

export function buildIngestionEmbed(
  session: RankingSession,
  movieTitle: string
): EmbedBuilder {
  const remaining = session.pendingIngestion.length;
  const total = remaining + session.ingestionCount;
  const current = session.ingestionCount + 1;

  return new EmbedBuilder()
    .setTitle(`🎬 Movie Check (${current}/${total})`)
    .setDescription(
      `**Would you be willing to watch this movie?**\n\n` +
      `> **${movieTitle}**\n\n` +
      `**Yes** = You'll rank this among your choices\n` +
      `**No** = Unwilling to watch (ranked below all others)`
    )
    .setColor(0x5865f2);
}

export function buildIngestionButtons(userId: string): ActionRowBuilder<ButtonBuilder>[] {
  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(`${IngestionButtonIds.YES}:${userId}`)
      .setLabel('Yes')
      .setStyle(ButtonStyle.Success),
    new ButtonBuilder()
      .setCustomId(`${IngestionButtonIds.NO}:${userId}`)
      .setLabel('No')
      .setStyle(ButtonStyle.Danger),
    new ButtonBuilder()
      .setCustomId(`${IngestionButtonIds.CANCEL}:${userId}`)
      .setLabel('Cancel')
      .setStyle(ButtonStyle.Secondary),
  );

  return [row];
}

export function buildIngestionMessage(session: RankingSession) {
  if (session.currentIngestionMovie === null) {
    throw new Error('No current ingestion movie');
  }

  const movie = movies.getById(session.currentIngestionMovie);
  if (!movie) {
    throw new Error('Movie not found');
  }

  return {
    embeds: [buildIngestionEmbed(session, movie.title)],
    components: buildIngestionButtons(session.userId),
  };
}

export function buildIngestionCompleteEmbed(count: number): EmbedBuilder {
  return new EmbedBuilder()
    .setTitle(`✅ All Done!`)
    .setDescription(
      count === 0
        ? `No new movies to check.`
        : `You checked ${count} movie${count === 1 ? '' : 's'}.`
    )
    .setColor(0x57f287);
}

export function buildIngestionCompleteMessage(count: number) {
  return {
    embeds: [buildIngestionCompleteEmbed(count)],
    components: [],
  };
}
