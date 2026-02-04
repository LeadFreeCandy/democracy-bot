import { Client, Interaction, Message, StringSelectMenuInteraction, TextChannel } from 'discord.js';
import { handleButtonInteraction } from './buttons';
import { handleModalSubmit } from './modals';
import { handleCommand } from '../commands';
import { buildControlPanelMessage } from '../components/control-panel';
import { buildAttendancePanelMessage } from '../components/attendance-panel';
import { EditSelectIds, buildSuccessMessage } from '../components/edit-menu';
import { RankingsSelectIds } from '../components/rankings-display';
import { controlPanel, attendancePanel, deleteMovie, movies, getNextWednesday, preferences } from '../database/queries';
import { createSession, deleteSession } from '../ranking/session';
import { config } from '../config';

const DELETE_DELAY_MS = 5000;
const EPHEMERAL_DELETE_DELAY_MS = 3000;

function scheduleDelete(message: Message, delayMs: number = DELETE_DELAY_MS): void {
  setTimeout(async () => {
    try {
      await message.delete();
    } catch {
      // Message may already be deleted
    }
  }, delayMs);
}

function scheduleEphemeralDelete(interaction: StringSelectMenuInteraction, delayMs: number = EPHEMERAL_DELETE_DELAY_MS): void {
  setTimeout(async () => {
    try {
      await interaction.deleteReply();
    } catch {
      // Reply may already be deleted
    }
  }, delayMs);
}

export async function handleInteraction(
  interaction: Interaction,
  client: Client
): Promise<void> {
  if (interaction.isChatInputCommand()) {
    await handleCommand(interaction, client);
  } else if (interaction.isButton()) {
    await handleButtonInteraction(interaction, client);
  } else if (interaction.isModalSubmit()) {
    await handleModalSubmit(interaction, client);
  } else if (interaction.isStringSelectMenu()) {
    await handleSelectMenu(interaction, client);
  }
}

async function handleSelectMenu(
  interaction: Interaction,
  client: Client
): Promise<void> {
  if (!interaction.isStringSelectMenu()) return;

  const [action, ownerId] = interaction.customId.split(':');

  // Check ownership
  if (ownerId && ownerId !== interaction.user.id) {
    await interaction.reply({
      content: "This isn't your menu!",
      ephemeral: true,
    });
    scheduleEphemeralDelete(interaction);
    return;
  }

  if (action === EditSelectIds.DELETE_MOVIE_SELECT) {
    const movieId = parseInt(interaction.values[0]);
    const movie = movies.getById(movieId);
    const title = movie?.title ?? 'Unknown';

    deleteMovie(movieId);
    await updateControlPanel(client);
    await interaction.update(buildSuccessMessage('Movie Deleted', `"${title}" has been removed.`));
    scheduleDelete(interaction.message as Message);
  } else if (action === RankingsSelectIds.RERANK_MOVIE) {
    const userId = interaction.user.id;
    const movieId = parseInt(interaction.values[0]);
    const movie = movies.getById(movieId);
    const title = movie?.title ?? 'Unknown';

    // Clear any existing ranking session
    deleteSession(userId);

    // Delete all preferences involving this movie for this user
    preferences.deleteForMovie(userId, movieId);

    // Create a new ranking session starting with this movie
    const session = createSession(userId, movieId);

    // No session or no comparisons needed (single movie or already placed)
    if (!session || session.movieToInsert === 0) {
      if (session) {
        deleteSession(userId);
      }
      await interaction.update({
        content: `Preferences for "${title}" have been cleared. Click **Rank Movies** to re-rank it.`,
        embeds: [],
        components: [],
      });
      return;
    }

    // Import comparison message builder
    const { buildComparisonMessage } = await import('../components/comparison');

    await interaction.update({
      content: `Re-ranking "${title}"...`,
      ...buildComparisonMessage(session),
    });
  }
}

export async function updateControlPanel(client: Client): Promise<void> {
  const panelData = controlPanel.get();
  if (!panelData) return;

  try {
    const channel = await client.channels.fetch(panelData.channel_id);
    if (!channel || !channel.isTextBased()) return;

    const textChannel = channel as TextChannel;
    const message = await textChannel.messages.fetch(panelData.message_id);
    await message.edit(buildControlPanelMessage());
  } catch (error) {
    console.error('Failed to update control panel:', error);
  }
}

export async function updateAttendancePanel(client: Client): Promise<void> {
  const panelData = attendancePanel.get();
  if (!panelData) return;

  try {
    const channel = await client.channels.fetch(panelData.channel_id);
    if (!channel || !channel.isTextBased()) return;

    const textChannel = channel as TextChannel;
    const message = await textChannel.messages.fetch(panelData.message_id);
    await message.edit(buildAttendancePanelMessage());
  } catch (error) {
    console.error('Failed to update attendance panel:', error);
  }
}

export async function setupControlPanel(client: Client): Promise<void> {
  const channelId = config.discord.movieChannelId;

  try {
    const channel = await client.channels.fetch(channelId);
    if (!channel || !channel.isTextBased()) {
      console.error('Movie channel not found or not a text channel');
      return;
    }

    const textChannel = channel as TextChannel;

    // Delete existing control panel if it exists
    const existingPanel = controlPanel.get();
    if (existingPanel) {
      try {
        const oldMessage = await textChannel.messages.fetch(existingPanel.message_id);
        await oldMessage.delete();
        console.log('Deleted old control panel');
      } catch {
        // Message doesn't exist anymore, that's fine
      }
    }

    // Delete existing attendance panel if it exists
    const existingAttendance = attendancePanel.get();
    if (existingAttendance) {
      try {
        const oldMessage = await textChannel.messages.fetch(existingAttendance.message_id);
        await oldMessage.delete();
        console.log('Deleted old attendance panel');
      } catch {
        // Message doesn't exist anymore, that's fine
      }
    }

    // Create attendance panel first
    const eventDate = getNextWednesday();
    const attendanceMessage = await textChannel.send(buildAttendancePanelMessage());
    attendancePanel.set(attendanceMessage.id, channelId, eventDate);
    console.log('Attendance panel created for', eventDate);

    // Create control panel (movie queue + buttons) below
    const controlMessage = await textChannel.send(buildControlPanelMessage());
    controlPanel.set(controlMessage.id, channelId);
    console.log('Control panel created');
  } catch (error) {
    console.error('Failed to setup control panel:', error);
  }
}
