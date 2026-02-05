import { ActionRowBuilder, ButtonBuilder, ButtonInteraction, ButtonStyle, Client } from 'discord.js';
import { ButtonIds } from '../components/control-panel';
import { AttendanceButtonIds } from '../components/attendance-panel';
import {
  ComparisonButtonIds,
  buildComparisonMessage,
  buildCompletionMessage,
} from '../components/comparison';
import {
  EditButtonIds,
  buildEditMenuMessage,
  buildDeleteMovieMessage,
  buildConfirmResetDbMessage,
  buildSuccessMessage,
} from '../components/edit-menu';
import { buildSubmitMovieModal } from '../components/modals';
import {
  RankingsButtonIds,
  buildUserRankingsMessage,
  buildConfirmClearRankingsMessage,
} from '../components/rankings-display';
import { dumpDatabase, deleteMovie, resetDatabase, resetUserData, attendance, getNextWednesday, formatFunFactsReport } from '../database/queries';
import {
  createSession,
  getSession,
  deleteSession,
} from '../ranking/session';
import { processChoice, Choice } from '../ranking/binary-insertion';
import { updateControlPanel, updateAttendancePanel } from './index';
import { syncWatchersRole } from '../roles/watchers';

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
    case ButtonIds.ADMIN:
      await handleAdmin(interaction);
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
    case EditButtonIds.SEND_REMINDERS:
      await handleSendReminders(interaction, client);
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
    case RankingsButtonIds.CLEAR_RANKINGS:
      await handleClearRankingsConfirm(interaction);
      return;
    case RankingsButtonIds.CONFIRM_CLEAR:
      await handleConfirmClearRankings(interaction);
      return;
    case RankingsButtonIds.CANCEL:
      await handleRankingsCancel(interaction);
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

  // Clear any existing session and start fresh
  deleteSession(userId);

  // Create session for ranking
  const session = createSession(userId);

  if (!session) {
    await interaction.reply({
      content: "You're all caught up! No movies to rank.",
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

async function handleMyRankings(interaction: ButtonInteraction): Promise<void> {
  const userId = interaction.user.id;
  await interaction.reply(buildUserRankingsMessage(userId));
}

async function handleRefreshRankings(interaction: ButtonInteraction): Promise<void> {
  const userId = interaction.user.id;
  await interaction.update(buildUserRankingsMessage(userId));
}

async function handleClearRankingsConfirm(interaction: ButtonInteraction): Promise<void> {
  const userId = interaction.user.id;
  await interaction.update(buildConfirmClearRankingsMessage(userId));
}

async function handleConfirmClearRankings(interaction: ButtonInteraction): Promise<void> {
  const userId = interaction.user.id;
  resetUserData(userId);
  await interaction.update({
    embeds: [buildSuccessMessage('Rankings Cleared', 'All your movie rankings have been deleted.').embeds![0]],
    components: [],
  });
}

async function handleRankingsCancel(interaction: ButtonInteraction): Promise<void> {
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
  const funFactsReport = formatFunFactsReport();

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

  // Always include fun facts as a file attachment
  const funFactsBuffer = Buffer.from(funFactsReport, 'utf-8');
  const files = [{
    attachment: funFactsBuffer,
    name: 'fun-facts.txt',
  }];

  const dbBuffer = Buffer.from(json, 'utf-8');
  const tbuffer = Buffer.from(tableBlock, 'utf-8');
  files.push({
    attachment: tbuffer,
    name: 'table.txt',
  });
  await interaction.reply({
    content: '\nDatabase dump and fun facts attached:',
    files,
    components: [buttons],
    ephemeral: true,
  });
}

async function handleDumpDbRefresh(interaction: ButtonInteraction): Promise<void> {
  const userId = interaction.user.id;
  const dump = dumpDatabase();
  const asciiTable = dump.condorcet_matrix.asciiTable;
  const funFactsReport = formatFunFactsReport();

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

  // Always include fun facts as a file attachment
  const funFactsBuffer = Buffer.from(funFactsReport, 'utf-8');
  const files = [{
    attachment: funFactsBuffer,
    name: 'fun-facts.txt',
  }];

  if (tableBlock.length + json.length + 20 < 1900) {
    await interaction.update({
      content: tableBlock + '\n**Database:**\n```json\n' + json + '\n```',
      files,
      components: [buttons],
    });
  } else {
    const dbBuffer = Buffer.from(json, 'utf-8');
    files.push({
      attachment: dbBuffer,
      name: 'database-dump.json',
    });
    await interaction.update({
      content: tableBlock + '\nDatabase dump and fun facts attached:',
      files,
      components: [buttons],
    });
  }
}

async function handleAdmin(interaction: ButtonInteraction): Promise<void> {
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

  // Sync watchers role
  await syncWatchersRole(client);
}

async function handleDeleteMovieMenu(interaction: ButtonInteraction): Promise<void> {
  const userId = interaction.user.id;
  await interaction.update(buildDeleteMovieMessage(userId));
}

async function handleResetDbConfirm(interaction: ButtonInteraction): Promise<void> {
  const userId = interaction.user.id;
  await interaction.update(buildConfirmResetDbMessage(userId));
}

async function handleConfirmResetDb(interaction: ButtonInteraction, client: Client): Promise<void> {
  resetDatabase();
  await updateControlPanel(client);
  await interaction.update(buildSuccessMessage('Database Reset', 'All data has been deleted.'));
}

async function handleSendReminders(interaction: ButtonInteraction, client: Client): Promise<void> {
  const { sendVoteReminder, sendAttendanceReminder } = await import('../scheduler/reminders');

  await interaction.update({
    embeds: [buildSuccessMessage('Sending Reminders', 'Sending vote and attendance reminders...').embeds![0]],
    components: [],
  });

  await sendVoteReminder(client);
  await sendAttendanceReminder(client);
}

async function handleEditBack(interaction: ButtonInteraction): Promise<void> {
  const userId = interaction.user.id;
  await interaction.update(buildEditMenuMessage(userId));
}

async function handleEditCancel(interaction: ButtonInteraction): Promise<void> {
  await interaction.deferUpdate();
  await interaction.deleteReply().catch(() => {
    // Message may already be deleted
  });
}

async function handlePreference(
  interaction: ButtonInteraction,
  choice: Choice,
  client: Client
): Promise<void> {
  const userId = interaction.user.id;
  const session = getSession(userId);

  if (!session) {
    await interaction.update({
      content: 'Session expired. Click **Rank Movies** to start again.',
      embeds: [],
      components: [],
    });
    return;
  }

  const result = processChoice(session, choice);

  if (result.done) {
    // Respond first to avoid interaction timeout, then update control panel
    await interaction.update(buildCompletionMessage(result.rankedCount ?? 0));
    await updateControlPanel(client);
  } else {
    await interaction.update(buildComparisonMessage(session));
  }
}

async function handleCancel(interaction: ButtonInteraction): Promise<void> {
  const userId = interaction.user.id;
  deleteSession(userId);
  await interaction.deferUpdate();
  await interaction.deleteReply().catch(() => {
    // Message may already be deleted
  });
}
