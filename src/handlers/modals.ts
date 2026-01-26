import { Client, ModalSubmitInteraction } from 'discord.js';
import { ModalIds, ModalFieldIds } from '../components/modals';
import { movies } from '../database/queries';
import { updateControlPanel } from './index';

const EPHEMERAL_DELETE_DELAY_MS = 3000;

function scheduleEphemeralDelete(interaction: ModalSubmitInteraction, delayMs: number = EPHEMERAL_DELETE_DELAY_MS): void {
  setTimeout(async () => {
    try {
      await interaction.deleteReply();
    } catch {
      // Reply may already be deleted
    }
  }, delayMs);
}

export async function handleModalSubmit(
  interaction: ModalSubmitInteraction,
  client: Client
): Promise<void> {
  const { customId } = interaction;

  switch (customId) {
    case ModalIds.SUBMIT_MOVIE:
      await handleSubmitMovieModal(interaction, client);
      return;
  }
}

async function handleSubmitMovieModal(
  interaction: ModalSubmitInteraction,
  client: Client
): Promise<void> {
  const title = interaction.fields.getTextInputValue(ModalFieldIds.MOVIE_TITLE).trim();
  const userId = interaction.user.id;

  if (!title) {
    await interaction.reply({
      content: 'Please provide a movie title.',
      ephemeral: true,
    });
    scheduleEphemeralDelete(interaction);
    return;
  }

  // Check for duplicate
  const existing = movies.getByTitle(title);
  if (existing) {
    await interaction.reply({
      content: `"${existing.title}" is already in the queue!`,
      ephemeral: true,
    });
    scheduleEphemeralDelete(interaction);
    return;
  }

  // Add movie
  movies.add(title, userId);

  // Update control panel
  await updateControlPanel(client);

  await interaction.reply({
    content: `Added "${title}"! Use **Rank Movies** to rank it.`,
    ephemeral: true,
  });
  scheduleEphemeralDelete(interaction);
}
