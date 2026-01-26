import {
  ActionRowBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
} from 'discord.js';

export const ModalIds = {
  SUBMIT_MOVIE: 'modal_submit_movie',
} as const;

export const ModalFieldIds = {
  MOVIE_TITLE: 'movie_title',
} as const;

export function buildSubmitMovieModal(): ModalBuilder {
  const titleInput = new TextInputBuilder()
    .setCustomId(ModalFieldIds.MOVIE_TITLE)
    .setLabel('Movie Title')
    .setPlaceholder('Enter the movie title')
    .setStyle(TextInputStyle.Short)
    .setRequired(true)
    .setMaxLength(200);

  const row = new ActionRowBuilder<TextInputBuilder>().addComponents(titleInput);

  return new ModalBuilder()
    .setCustomId(ModalIds.SUBMIT_MOVIE)
    .setTitle('Submit a Movie')
    .addComponents(row);
}
