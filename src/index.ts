import { Client, GatewayIntentBits, REST, Routes } from 'discord.js';
import { config } from './config';
import { initializeDatabase } from './database';
import { initializeVoteDatabase } from './votes/database';
import { restoreVoteTimers } from './votes/scheduler';
import { handleInteraction, setupControlPanel } from './handlers';
import { setupScheduler } from './scheduler/reminders';
import { commands } from './commands';
import { syncWatchersRole } from './roles/watchers';

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.GuildMembers,
  ],
});

client.once('ready', async () => {
  console.log(`Logged in as ${client.user?.tag}`);

  // Initialize databases
  await initializeDatabase();
  console.log('Movie database initialized');

  await initializeVoteDatabase();
  console.log('Vote database initialized');

  // Restore active vote timers
  restoreVoteTimers(client);

  // Register slash commands to guilds (instant) instead of global (up to 1 hour)
  const rest = new REST().setToken(config.discord.token);
  const guildIds = ['1153426480487993445', '1168648679339602001'];
  for (const guildId of guildIds) {
    try {
      await rest.put(
        Routes.applicationGuildCommands(client.user!.id, guildId),
        { body: commands.map(cmd => cmd.toJSON()) }
      );
      console.log(`Slash commands registered to guild ${guildId}`);
    } catch (error) {
      console.error(`Failed to register slash commands to guild ${guildId}:`, error);
    }
  }

  // Setup control panel
  await setupControlPanel(client);

  // Setup scheduler
  setupScheduler(client);

  // Sync watchers role with attendance list
  await syncWatchersRole(client);

  console.log('Bot is ready!');
});

client.on('interactionCreate', async (interaction) => {
  try {
    await handleInteraction(interaction, client);
  } catch (error) {
    console.error('Error handling interaction:', error);

    // Try to respond with error message
    try {
      if (interaction.isRepliable() && !interaction.replied && !interaction.deferred) {
        await interaction.reply({
          content: 'An error occurred. Please try again.',
          ephemeral: true,
        });
      }
    } catch {
      // Ignore errors when trying to send error response
    }
  }
});

client.login(config.discord.token);
