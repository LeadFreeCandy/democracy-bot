import { Client, GatewayIntentBits } from 'discord.js';
import { config } from './config';
import { initializeDatabase } from './database';
import { handleInteraction, setupControlPanel } from './handlers';
import { setupScheduler } from './scheduler/reminders';

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
  ],
});

client.once('ready', async () => {
  console.log(`Logged in as ${client.user?.tag}`);

  // Initialize database
  await initializeDatabase();
  console.log('Database initialized');

  // Setup control panel
  await setupControlPanel(client);

  // Setup scheduler
  setupScheduler(client);

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
