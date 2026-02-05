import {
  SlashCommandBuilder,
  ChatInputCommandInteraction,
  Client,
  PermissionFlagsBits,
} from 'discord.js';
import { attendance, getNextWednesday } from '../database/queries';
import { updateAttendancePanel } from '../handlers';
import { syncWatchersRole } from '../roles/watchers';

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
  }
}
