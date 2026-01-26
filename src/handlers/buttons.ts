import { ActionRowBuilder, ButtonBuilder, ButtonInteraction, ButtonStyle, Client } from 'discord.js';
import { ButtonIds } from '../components/control-panel';
import { AttendanceButtonIds } from '../components/attendance-panel';
import {
  ComparisonButtonIds,
  buildComparisonMessage,
  buildCompletionMessage,
  buildCancelledMessage,
} from '../components/comparison';
import {
  IngestionButtonIds,
  buildIngestionMessage,
  buildIngestionCompleteMessage,
} from '../components/ingestion';
import {
  EditButtonIds,
  buildEditMenuMessage,
  buildDeleteMovieMessage,
  buildConfirmResetDbMessage,
  buildConfirmResetMyDataMessage,
  buildSuccessMessage,
} from '../components/edit-menu';
import { buildSubmitMovieModal } from '../components/modals';
import { RankingsButtonIds, buildUserRankingsMessage } from '../components/rankings-display';
import { responses, dumpDatabase, deleteMovie, resetDatabase, resetUserData, attendance, getNextWednesday } from '../database/queries';
import {
  createSession,
  getSession,
  deleteSession,
  processIngestionResponse,
} from '../ranking/session';
import { processChoice, Choice } from '../ranking/binary-insertion';
import { updateControlPanel, updateAttendancePanel } from './index';

function parseButtonId(customId: string): { action: string; userId?: string } {
  const parts = customId.split(':');
  return { action: parts[0], userId: parts[1] };
}

export async function handleButtonInteraction(
  interaction: ButtonInteraction,
  client: Client
): Promise<void> {
  const { customId } = interaction;
  const { action, userId: buttonOwnerId } = parseButtonId(customId);

  // Control panel buttons (no owner check needed)
  switch (action) {
    case ButtonIds.SUBMIT_MOVIE:
      await handleSubmitMovie(interaction);
      return;
    case ButtonIds.RANK_MOVIES:
      await handleRankMovies(interaction, client);
      return;
    case ButtonIds.MY_RANKINGS:
      await handleMyRankings(interaction);
      return;
    case ButtonIds.EDIT:
      await handleEdit(interaction);
      return;
  }

  // Attendance buttons (no owner check needed)
  switch (action) {
    case AttendanceButtonIds.ATTENDING:
      await handleAttendance(interaction, client, true);
      return;
    case AttendanceButtonIds.NOT_ATTENDING:
      await handleAttendance(interaction, client, false);
      return;
  }

  // Session/Edit buttons - check ownership
  if (buttonOwnerId && buttonOwnerId !== interaction.user.id) {
    await interaction.reply({
      content: "This isn't your session!",
      ephemeral: true,
    });
    return;
  }

  // Edit menu buttons
  switch (action) {
    case EditButtonIds.DELETE_MOVIE:
      await handleDeleteMovieMenu(interaction);
      return;
    case EditButtonIds.RESET_DB:
      await handleResetDbConfirm(interaction);
      return;
    case EditButtonIds.RESET_MY_DATA:
      await handleResetMyDataConfirm(interaction);
      return;
    case EditButtonIds.DUMP_DB:
      await handleDumpDb(interaction);
      return;
    case EditButtonIds.DUMP_REFRESH:
      await handleDumpDbRefresh(interaction);
      return;
    case EditButtonIds.CONFIRM_RESET_DB:
      await handleConfirmResetDb(interaction, client);
      return;
    case EditButtonIds.CONFIRM_RESET_MY_DATA:
      await handleConfirmResetMyData(interaction);
      return;
    case EditButtonIds.BACK:
      await handleEditBack(interaction);
      return;
    case EditButtonIds.CANCEL:
      await handleEditCancel(interaction);
      return;
  }

  // Rankings ephemeral buttons
  switch (action) {
    case RankingsButtonIds.RANK_MOVIES:
      await handleRankMovies(interaction, client);
      return;
    case RankingsButtonIds.REFRESH:
      await handleRefreshRankings(interaction);
      return;
  }

  // Ingestion buttons
  switch (action) {
    case IngestionButtonIds.YES:
      await handleIngestionResponse(interaction, 'yes', client);
      return;
    case IngestionButtonIds.NO:
      await handleIngestionResponse(interaction, 'no', client);
      return;
    case IngestionButtonIds.CANCEL:
      await handleCancel(interaction);
      return;
  }

  // Comparison buttons
  switch (action) {
    case ComparisonButtonIds.PREFER_A:
      await handlePreference(interaction, 'a', client);
      return;
    case ComparisonButtonIds.PREFER_B:
      await handlePreference(interaction, 'b', client);
      return;
    case ComparisonButtonIds.NO_PREFERENCE:
      await handlePreference(interaction, 'tie', client);
      return;
    case ComparisonButtonIds.CANCEL:
      await handleCancel(interaction);
      return;
  }
}

async function handleSubmitMovie(interaction: ButtonInteraction): Promise<void> {
  const modal = buildSubmitMovieModal();
  await interaction.showModal(modal);
}

async function handleRankMovies(interaction: ButtonInteraction, client: Client): Promise<void> {
  const userId = interaction.user.id;

  // Check if user already has a session
  const existingSession = getSession(userId);
  if (existingSession) {
    await interaction.reply({
      content: 'You already have a ranking session open. Complete or cancel it first!',
      ephemeral: true,
    });
    return;
  }

  // Get unresponded movies (need Y/N)
  const unrespondedMovies = responses.getUnrespondedMovies(userId);
  const unrespondedIds = unrespondedMovies.map(m => m.id);

  // Get movies that need ranking (already have Y response)
  const moviesToRank = responses.getMoviesToRank(userId);
  const moviesWithResponses = moviesToRank.map(m => ({
    id: m.id,
    response: responses.getResponse(userId, m.id)!,
  }));

  // Create session
  const session = createSession(userId, unrespondedIds, moviesWithResponses);

  if (!session) {
    await interaction.reply({
      content: "You're all caught up! No movies to check or rank.",
      ephemeral: true,
    });
    return;
  }

  // Send ephemeral message based on phase
  if (session.phase === 'ingestion') {
    await interaction.reply({
      ...buildIngestionMessage(session),
      ephemeral: true,
    });
  } else {
    // Check if there's actually ranking to do
    if (session.sortedList.length === 0 && session.pendingMovies.length === 0) {
      deleteSession(userId);
      await interaction.reply({
        ...buildIngestionCompleteMessage(0),
        ephemeral: true,
      });
      return;
    }

    // Check if ranking is already complete (all movies auto-inserted, no comparisons needed)
    if (session.movieToInsert === 0) {
      const rankedCount = session.moviesRankedThisSession;
      deleteSession(userId);
      await interaction.reply({
        ...buildCompletionMessage(rankedCount),
        ephemeral: true,
      });
      return;
    }

    await interaction.reply({
      ...buildComparisonMessage(session),
      ephemeral: true,
    });
  }
}

async function handleMyRankings(interaction: ButtonInteraction): Promise<void> {
  const userId = interaction.user.id;
  await interaction.reply(buildUserRankingsMessage(userId));
}

async function handleRefreshRankings(interaction: ButtonInteraction): Promise<void> {
  const userId = interaction.user.id;
  await interaction.update(buildUserRankingsMessage(userId));
}

function buildDumpDbButtons(userId: string): ActionRowBuilder<ButtonBuilder> {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(`${EditButtonIds.DUMP_REFRESH}:${userId}`)
      .setLabel('Refresh')
      .setStyle(ButtonStyle.Secondary)
      .setEmoji('🔄'),
  );
}

async function handleDumpDb(interaction: ButtonInteraction): Promise<void> {
  const userId = interaction.user.id;
  const dump = dumpDatabase();
  const asciiTable = dump.condorcet_matrix.asciiTable;

  // Create JSON without the asciiTable (since it's shown separately)
  const jsonDump = {
    ...dump,
    condorcet_matrix: {
      movies: dump.condorcet_matrix.movies,
      matrix: dump.condorcet_matrix.matrix,
    },
  };
  const json = JSON.stringify(jsonDump, null, 2);

  // Format: ASCII table first, then JSON
  const tableBlock = '**Condorcet Matrix:**\n```\n' + asciiTable + '\n```\n';
  const buttons = buildDumpDbButtons(userId);

  if (tableBlock.length + json.length + 20 < 1900) {
    await interaction.reply({
      content: tableBlock + '\n**Database:**\n```json\n' + json + '\n```',
      components: [buttons],
      ephemeral: true,
    });
  } else {
    const buffer = Buffer.from(json, 'utf-8');
    await interaction.reply({
      content: tableBlock + '\nDatabase dump attached:',
      files: [{
        attachment: buffer,
        name: 'database-dump.json',
      }],
      components: [buttons],
      ephemeral: true,
    });
  }
}

async function handleDumpDbRefresh(interaction: ButtonInteraction): Promise<void> {
  const userId = interaction.user.id;
  const dump = dumpDatabase();
  const asciiTable = dump.condorcet_matrix.asciiTable;

  const jsonDump = {
    ...dump,
    condorcet_matrix: {
      movies: dump.condorcet_matrix.movies,
      matrix: dump.condorcet_matrix.matrix,
    },
  };
  const json = JSON.stringify(jsonDump, null, 2);

  const tableBlock = '**Condorcet Matrix:**\n```\n' + asciiTable + '\n```\n';
  const buttons = buildDumpDbButtons(userId);

  if (tableBlock.length + json.length + 20 < 1900) {
    await interaction.update({
      content: tableBlock + '\n**Database:**\n```json\n' + json + '\n```',
      components: [buttons],
    });
  } else {
    const buffer = Buffer.from(json, 'utf-8');
    await interaction.update({
      content: tableBlock + '\nDatabase dump attached:',
      files: [{
        attachment: buffer,
        name: 'database-dump.json',
      }],
      components: [buttons],
    });
  }
}

async function handleEdit(interaction: ButtonInteraction): Promise<void> {
  const userId = interaction.user.id;
  await interaction.reply({
    ...buildEditMenuMessage(userId),
    ephemeral: true,
  });
}

async function handleAttendance(
  interaction: ButtonInteraction,
  client: Client,
  attending: boolean
): Promise<void> {
  const userId = interaction.user.id;
  const eventDate = getNextWednesday();

  // Record attendance
  attendance.set(userId, eventDate, attending);

  // Update both panels (attendance changes affect vote counts)
  await interaction.deferUpdate();
  await updateAttendancePanel(client);
  await updateControlPanel(client);
}

async function handleDeleteMovieMenu(interaction: ButtonInteraction): Promise<void> {
  const userId = interaction.user.id;
  await interaction.update(buildDeleteMovieMessage(userId));
}

async function handleResetDbConfirm(interaction: ButtonInteraction): Promise<void> {
  const userId = interaction.user.id;
  await interaction.update(buildConfirmResetDbMessage(userId));
}

async function handleResetMyDataConfirm(interaction: ButtonInteraction): Promise<void> {
  const userId = interaction.user.id;
  await interaction.update(buildConfirmResetMyDataMessage(userId));
}

async function handleConfirmResetDb(interaction: ButtonInteraction, client: Client): Promise<void> {
  resetDatabase();
  await updateControlPanel(client);
  await interaction.update(buildSuccessMessage('Database Reset', 'All data has been deleted.'));
}

async function handleConfirmResetMyData(interaction: ButtonInteraction): Promise<void> {
  const userId = interaction.user.id;
  resetUserData(userId);
  await interaction.update(buildSuccessMessage('Data Reset', 'Your responses and rankings have been deleted.'));
}

async function handleEditBack(interaction: ButtonInteraction): Promise<void> {
  const userId = interaction.user.id;
  await interaction.update(buildEditMenuMessage(userId));
}

async function handleEditCancel(interaction: ButtonInteraction): Promise<void> {
  await interaction.update({
    content: 'Menu closed.',
    embeds: [],
    components: [],
  });
}

async function handleIngestionResponse(
  interaction: ButtonInteraction,
  response: 'yes' | 'no',
  client: Client
): Promise<void> {
  const userId = interaction.user.id;
  const session = getSession(userId);

  if (!session || session.phase !== 'ingestion') {
    await interaction.update({
      content: 'Session expired. Click **Rank Movies** to start again.',
      embeds: [],
      components: [],
    });
    return;
  }

  const result = processIngestionResponse(session, response);

  if (result.done) {
    deleteSession(userId);
    await interaction.update(buildIngestionCompleteMessage(session.ingestionCount));
    return;
  }

  if (result.startRanking) {
    // Transition to ranking phase
    // Check if there's actually something to rank
    if (session.movieToInsert === 0 || (session.sortedList.length === 0 && session.pendingMovies.length === 0)) {
      // Nothing to rank (all movies were "no" or already ranked)
      deleteSession(userId);
      await interaction.update(buildIngestionCompleteMessage(session.ingestionCount));
      return;
    }

    // Handle case where there's only one movie to rank
    if (session.sortedList.length === 0 && session.pendingMovies.length === 0 && session.movieToInsert) {
      session.sortedList = [session.movieToInsert];
      session.moviesRankedThisSession = 1;
      deleteSession(userId);
      await interaction.update(buildCompletionMessage(1));
      return;
    }

    // Need at least 2 movies to compare
    if (session.sortedList.length === 0 && session.movieToInsert) {
      // First movie goes in automatically
      session.sortedList = [session.movieToInsert];
      session.moviesRankedThisSession = 1;

      if (session.pendingMovies.length === 0) {
        deleteSession(userId);
        await interaction.update(buildCompletionMessage(1));
        return;
      }

      // Set up next movie for comparison
      session.movieToInsert = session.pendingMovies.shift()!;
      session.low = 0;
      session.high = session.sortedList.length;
      session.currentMid = Math.floor((session.low + session.high) / 2);
    }

    await interaction.update(buildComparisonMessage(session));
    return;
  }

  // Continue ingestion
  await interaction.update(buildIngestionMessage(session));
}

async function handlePreference(
  interaction: ButtonInteraction,
  choice: Choice,
  client: Client
): Promise<void> {
  const userId = interaction.user.id;
  const session = getSession(userId);

  if (!session || session.phase !== 'ranking') {
    await interaction.update({
      content: 'Session expired. Click **Rank Movies** to start again.',
      embeds: [],
      components: [],
    });
    return;
  }

  const result = processChoice(session, choice);

  if (result.done) {
    await updateControlPanel(client);
    await interaction.update(buildCompletionMessage(result.rankedCount ?? 0));
  } else {
    await interaction.update(buildComparisonMessage(session));
  }
}

async function handleCancel(interaction: ButtonInteraction): Promise<void> {
  const userId = interaction.user.id;
  deleteSession(userId);
  await interaction.update(buildCancelledMessage());
}
