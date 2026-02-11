import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder,
} from 'discord.js';
import { movies } from '../database/queries';

export const EditButtonIds = {
  DELETE_MOVIE: 'edit_delete_movie',
  MARK_WATCHED: 'edit_mark_watched',
  RESET_DB: 'edit_reset_db',
  SEND_REMINDERS: 'edit_send_reminders',
  DUMP_DB: 'edit_dump_db',
  DUMP_REFRESH: 'edit_dump_refresh',
  BACK: 'edit_back',
  CONFIRM_RESET_DB: 'edit_confirm_reset_db',
  CANCEL: 'edit_cancel',
} as const;

export const EditSelectIds = {
  DELETE_MOVIE_SELECT: 'edit_delete_movie_select',
  MARK_WATCHED_SELECT: 'edit_mark_watched_select',
} as const;

export function buildEditMenuEmbed(): EmbedBuilder {
  return new EmbedBuilder()
    .setTitle('⚙️ Admin Panel')
    .setDescription('Manage movies, send reminders, and export data.')
    .setColor(0x5865f2);
}

export function buildEditMenuButtons(userId: string): ActionRowBuilder<ButtonBuilder>[] {
  const row1 = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(`${EditButtonIds.DELETE_MOVIE}:${userId}`)
      .setLabel('Delete Movie')
      .setStyle(ButtonStyle.Danger)
      .setEmoji('🗑️'),
    new ButtonBuilder()
      .setCustomId(`${EditButtonIds.MARK_WATCHED}:${userId}`)
      .setLabel('Mark as Watched')
      .setStyle(ButtonStyle.Success)
      .setEmoji('✅'),
    new ButtonBuilder()
      .setCustomId(`${EditButtonIds.SEND_REMINDERS}:${userId}`)
      .setLabel('Send Reminders')
      .setStyle(ButtonStyle.Primary)
      .setEmoji('📢'),
  );

  const row2 = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(`${EditButtonIds.DUMP_DB}:${userId}`)
      .setLabel('Export Data')
      .setStyle(ButtonStyle.Secondary)
      .setEmoji('📤'),
    new ButtonBuilder()
      .setCustomId(`${EditButtonIds.RESET_DB}:${userId}`)
      .setLabel('Reset Everything')
      .setStyle(ButtonStyle.Danger)
      .setEmoji('⚠️'),
  );

  const row3 = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(`${EditButtonIds.CANCEL}:${userId}`)
      .setLabel('Close')
      .setStyle(ButtonStyle.Secondary),
  );

  return [row1, row2, row3];
}

export function buildEditMenuMessage(userId: string) {
  return {
    embeds: [buildEditMenuEmbed()],
    components: buildEditMenuButtons(userId),
  };
}

// Delete movie select menu
export function buildDeleteMovieEmbed(): EmbedBuilder {
  return new EmbedBuilder()
    .setTitle('Delete Movie')
    .setDescription('Select a movie to delete:')
    .setColor(0xed4245);
}

export function buildDeleteMovieSelect(userId: string): ActionRowBuilder<StringSelectMenuBuilder>[] {
  const unwatchedMovies = movies.getUnwatched();

  if (unwatchedMovies.length === 0) {
    return [];
  }

  const options = unwatchedMovies.slice(0, 25).map(m =>
    new StringSelectMenuOptionBuilder()
      .setLabel(m.title.slice(0, 100))
      .setValue(m.id.toString())
  );

  const select = new StringSelectMenuBuilder()
    .setCustomId(`${EditSelectIds.DELETE_MOVIE_SELECT}:${userId}`)
    .setPlaceholder('Select a movie to delete')
    .addOptions(options);

  return [new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(select)];
}

export function buildDeleteMovieBackButton(userId: string): ActionRowBuilder<ButtonBuilder> {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(`${EditButtonIds.BACK}:${userId}`)
      .setLabel('Back')
      .setStyle(ButtonStyle.Secondary),
  );
}

export function buildDeleteMovieMessage(userId: string) {
  const selectRows = buildDeleteMovieSelect(userId);

  if (selectRows.length === 0) {
    return {
      embeds: [new EmbedBuilder()
        .setTitle('Delete Movie')
        .setDescription('No movies in the queue to delete.')
        .setColor(0xed4245)],
      components: [buildDeleteMovieBackButton(userId)],
    };
  }

  return {
    embeds: [buildDeleteMovieEmbed()],
    components: [...selectRows, buildDeleteMovieBackButton(userId)],
  };
}

// Confirmation dialogs
export function buildConfirmResetDbEmbed(): EmbedBuilder {
  return new EmbedBuilder()
    .setTitle('Confirm Reset Database')
    .setDescription(
      '**Are you sure you want to reset the entire database?**\n\n' +
      'This will delete:\n' +
      '- All movies\n' +
      '- All rankings\n\n' +
      '**This cannot be undone!**'
    )
    .setColor(0xed4245);
}


export function buildConfirmButtons(confirmId: string, userId: string): ActionRowBuilder<ButtonBuilder>[] {
  return [new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(`${confirmId}:${userId}`)
      .setLabel('Yes, Delete')
      .setStyle(ButtonStyle.Danger),
    new ButtonBuilder()
      .setCustomId(`${EditButtonIds.CANCEL}:${userId}`)
      .setLabel('Cancel')
      .setStyle(ButtonStyle.Secondary),
  )];
}

export function buildConfirmResetDbMessage(userId: string) {
  return {
    embeds: [buildConfirmResetDbEmbed()],
    components: buildConfirmButtons(EditButtonIds.CONFIRM_RESET_DB, userId),
  };
}


export function buildSuccessEmbed(title: string, description: string): EmbedBuilder {
  return new EmbedBuilder()
    .setTitle(title)
    .setDescription(description)
    .setColor(0x57f287);
}

export function buildSuccessMessage(title: string, description: string) {
  return {
    embeds: [buildSuccessEmbed(title, description)],
    components: [],
  };
}

// Mark as Watched select menu
export function buildMarkWatchedMessage(userId: string) {
  const unwatchedMovies = movies.getUnwatched();

  if (unwatchedMovies.length === 0) {
    return {
      embeds: [new EmbedBuilder()
        .setTitle('Mark as Watched')
        .setDescription('No movies in the queue to mark as watched.')
        .setColor(0x57f287)],
      components: [buildDeleteMovieBackButton(userId)],
    };
  }

  const options = unwatchedMovies.slice(0, 25).map(m =>
    new StringSelectMenuOptionBuilder()
      .setLabel(m.title.slice(0, 100))
      .setValue(m.id.toString())
  );

  const select = new StringSelectMenuBuilder()
    .setCustomId(`${EditSelectIds.MARK_WATCHED_SELECT}:${userId}`)
    .setPlaceholder('Select a movie to mark as watched')
    .addOptions(options);

  const selectRow = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(select);

  return {
    embeds: [new EmbedBuilder()
      .setTitle('Mark as Watched')
      .setDescription('Select a movie to mark as watched:')
      .setColor(0x57f287)],
    components: [selectRow, buildDeleteMovieBackButton(userId)],
  };
}
