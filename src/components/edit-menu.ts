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
  RESET_DB: 'edit_reset_db',
  RESET_MY_DATA: 'edit_reset_my_data',
  DUMP_DB: 'edit_dump_db',
  DUMP_REFRESH: 'edit_dump_refresh',
  BACK: 'edit_back',
  CONFIRM_RESET_DB: 'edit_confirm_reset_db',
  CONFIRM_RESET_MY_DATA: 'edit_confirm_reset_my_data',
  CANCEL: 'edit_cancel',
} as const;

export const EditSelectIds = {
  DELETE_MOVIE_SELECT: 'edit_delete_movie_select',
} as const;

export function buildEditMenuEmbed(): EmbedBuilder {
  return new EmbedBuilder()
    .setTitle('⚙️ Settings & Admin')
    .setDescription('Manage movies, data, and view debug info.')
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
      .setCustomId(`${EditButtonIds.RESET_MY_DATA}:${userId}`)
      .setLabel('Reset My Data')
      .setStyle(ButtonStyle.Danger)
      .setEmoji('🔄'),
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

export function buildConfirmResetMyDataEmbed(): EmbedBuilder {
  return new EmbedBuilder()
    .setTitle('Confirm Reset My Data')
    .setDescription(
      '**Are you sure you want to reset your data?**\n\n' +
      'This will delete:\n' +
      '- Your movie rankings\n\n' +
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

export function buildConfirmResetMyDataMessage(userId: string) {
  return {
    embeds: [buildConfirmResetMyDataEmbed()],
    components: buildConfirmButtons(EditButtonIds.CONFIRM_RESET_MY_DATA, userId),
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
