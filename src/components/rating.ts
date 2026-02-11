import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
} from 'discord.js';
import { ratings } from '../database/queries';

export const RatingButtonIds = {
  RATE_MOVIE: 'rate_movie',
} as const;

export function buildRatingMessage(movieId: number, movieTitle: string) {
  const movieRatings = ratings.getForMovie(movieId);
  const average = ratings.getAverage(movieId);

  let description = `How would you rate **${movieTitle}**?\nClick a button below to rate it from 1 to 10.`;

  if (movieRatings.length > 0) {
    description += `\n\n**Ratings so far:** ${movieRatings.length} vote(s)`;
    description += `\n**Average:** ${average!.toFixed(1)} / 10`;
  }

  const embed = new EmbedBuilder()
    .setTitle(`Rate: ${movieTitle}`)
    .setDescription(description)
    .setColor(0xfee75c);

  const row1 = new ActionRowBuilder<ButtonBuilder>().addComponents(
    ...([1, 2, 3, 4, 5] as const).map(n =>
      new ButtonBuilder()
        .setCustomId(`${RatingButtonIds.RATE_MOVIE}:${movieId}:${n}`)
        .setLabel(n.toString())
        .setStyle(ButtonStyle.Secondary)
    )
  );

  const row2 = new ActionRowBuilder<ButtonBuilder>().addComponents(
    ...([6, 7, 8, 9, 10] as const).map(n =>
      new ButtonBuilder()
        .setCustomId(`${RatingButtonIds.RATE_MOVIE}:${movieId}:${n}`)
        .setLabel(n.toString())
        .setStyle(ButtonStyle.Secondary)
    )
  );

  return {
    embeds: [embed],
    components: [row1, row2],
  };
}
