import {
  SlashCommandBuilder,
  ChatInputCommandInteraction,
  Client,
  PermissionFlagsBits,
} from 'discord.js';
import { attendance, getNextWednesday } from '../database/queries';
import { updateAttendancePanel } from '../handlers';
import { syncWatchersRole } from '../roles/watchers';
import { createVote, getVote, getVoteOptions, setVoteMessageId } from '../votes/database';
import { buildVotePanelMessage } from '../votes/components';
import { scheduleVoteExpiration } from '../votes/scheduler';

export const commands = [
  new SlashCommandBuilder()
    .setName('addattendee')
    .setDescription('Add a user to the attendance list')
    .addUserOption(option =>
      option
        .setName('user')
        .setDescription('The user to add')
        .setRequired(true)
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages),

  new SlashCommandBuilder()
    .setName('removeattendee')
    .setDescription('Remove a user from the attendance list')
    .addUserOption(option =>
      option
        .setName('user')
        .setDescription('The user to remove')
        .setRequired(true)
    )
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages),

  new SlashCommandBuilder()
    .setName('vote')
    .setDescription('Create a ranked-choice vote')
    .addStringOption(option =>
      option
        .setName('title')
        .setDescription('The question to vote on')
        .setRequired(true)
    )
    .addStringOption(option =>
      option
        .setName('options')
        .setDescription('Comma-separated choices (e.g. "Option A, Option B, Option C")')
        .setRequired(true)
    )
    .addIntegerOption(option =>
      option
        .setName('duration')
        .setDescription('Hours until the vote closes')
        .setRequired(true)
        .setMinValue(1)
        .setMaxValue(168)
    ),
];

export async function handleCommand(
  interaction: ChatInputCommandInteraction,
  client: Client
): Promise<void> {
  const { commandName } = interaction;
  const eventDate = getNextWednesday();

  if (commandName === 'addattendee') {
    const user = interaction.options.getUser('user', true);

    attendance.set(user.id, eventDate, true);
    await updateAttendancePanel(client);
    await syncWatchersRole(client);

    await interaction.reply({
      content: `Added <@${user.id}> to the attendance list for ${eventDate}.`,
      ephemeral: true,
    });
  } else if (commandName === 'removeattendee') {
    const user = interaction.options.getUser('user', true);

    attendance.set(user.id, eventDate, false);
    await updateAttendancePanel(client);
    await syncWatchersRole(client);

    await interaction.reply({
      content: `Removed <@${user.id}> from the attendance list for ${eventDate}.`,
      ephemeral: true,
    });
  } else if (commandName === 'vote') {
    await handleVoteCommand(interaction, client);
  }
}

async function handleVoteCommand(
  interaction: ChatInputCommandInteraction,
  client: Client
): Promise<void> {
  const title = interaction.options.getString('title', true);
  const optionsRaw = interaction.options.getString('options', true);
  const duration = interaction.options.getInteger('duration', true);

  const optionLabels = optionsRaw.split(',').map(s => s.trim()).filter(s => s.length > 0);

  if (optionLabels.length < 2) {
    await interaction.reply({
      content: 'You need at least 2 options (comma-separated).',
      ephemeral: true,
    });
    return;
  }

  if (optionLabels.length > 25) {
    await interaction.reply({
      content: 'Maximum 25 options allowed.',
      ephemeral: true,
    });
    return;
  }

  const channelId = interaction.channelId;
  const { voteId } = createVote(title, interaction.user.id, channelId, duration, optionLabels);

  const vote = getVote(voteId)!;
  const options = getVoteOptions(voteId);

  // Send the vote panel as a public message (no voters yet)
  const message = await interaction.reply({
    ...buildVotePanelMessage(vote, options, []),
    fetchReply: true,
  });

  // Store the message ID so we can update the panel later
  setVoteMessageId(voteId, message.id);

  // Schedule expiration
  scheduleVoteExpiration(voteId, vote.ends_at, client);
}
