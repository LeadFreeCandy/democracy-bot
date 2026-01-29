import cron from 'node-cron';
import { Client, TextChannel } from 'discord.js';
import { config } from '../config';
import { users, controlPanel } from '../database/queries';
import { cleanupExpiredSessions } from '../ranking/session';

export function setupScheduler(client: Client): void {
  // Tuesday at 6 PM - Movie night reminder
  cron.schedule(
    '0 18 * * 2',
    async () => {
      await sendReminderMessage(client);
    },
    { timezone: config.scheduler.timezone }
  );

  // Cleanup expired sessions every 15 minutes
  cron.schedule('*/15 * * * *', () => {
    cleanupExpiredSessions();
  });

  console.log('Scheduler initialized');
}

async function sendReminderMessage(client: Client): Promise<void> {
  const panelData = controlPanel.get();
  if (!panelData) {
    console.error('No control panel found for reminder');
    return;
  }

  try {
    const channel = await client.channels.fetch(panelData.channel_id);
    if (!channel || !channel.isTextBased()) {
      console.error('Channel not found for reminder');
      return;
    }

    const textChannel = channel as TextChannel;

    // Get users with unranked movies
    const usersWithUnranked = users.getWithUnrankedMovies();

    if (usersWithUnranked.length === 0) {
      await textChannel.send('**Movie night tomorrow!**\n\nEveryone is all caught up!');
      return;
    }

    const mentions = usersWithUnranked.map(id => `<@${id}>`).join(' ');

    await textChannel.send(
      `**Movie night tomorrow!**\n\n` +
      `${mentions}\n\n` +
      `You have movies to rank. Click **Rank Movies** above!`
    );

    console.log('Reminder sent');
  } catch (error) {
    console.error('Failed to send reminder:', error);
  }
}

// Export for manual triggering if needed
export { sendReminderMessage };
