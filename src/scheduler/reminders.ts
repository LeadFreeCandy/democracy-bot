import cron from 'node-cron';
import { Client, TextChannel } from 'discord.js';
import { config } from '../config';
import {
  controlPanel,
  reminders,
  getNextWednesday,
  getAttendeesWithUnrankedMovies,
  getUsersWhoShouldMarkAttendance,
  computeCondorcetRanking,
} from '../database/queries';
import { cleanupExpiredSessions } from '../ranking/session';

export function setupScheduler(client: Client): void {
  // Tuesday at 12 PM (noon) - Vote and attendance reminders
  cron.schedule(
    '0 12 * * 2',
    async () => {
      await sendVoteReminder(client);
      await sendAttendanceReminder(client);
    },
    { timezone: config.scheduler.timezone }
  );

  // Tuesday at 6 PM - Announce winner
  cron.schedule(
    '0 18 * * 2',
    async () => {
      await announceWinner(client);
    },
    { timezone: config.scheduler.timezone }
  );

  // Cleanup expired sessions every 15 minutes
  cron.schedule('*/15 * * * *', () => {
    cleanupExpiredSessions();
  });

  console.log('Scheduler initialized');
}

async function getChannel(client: Client): Promise<TextChannel | null> {
  const panelData = controlPanel.get();
  if (!panelData) {
    console.error('No control panel found for reminder');
    return null;
  }

  try {
    const channel = await client.channels.fetch(panelData.channel_id);
    if (!channel || !channel.isTextBased()) {
      console.error('Channel not found for reminder');
      return null;
    }
    return channel as TextChannel;
  } catch (error) {
    console.error('Failed to fetch channel:', error);
    return null;
  }
}

/**
 * Send reminder to attendees who haven't voted yet.
 * Only sends once per event date.
 */
async function sendVoteReminder(client: Client): Promise<void> {
  const eventDate = getNextWednesday();
  const reminderType = 'vote_reminder';

  // Check if already sent
  if (reminders.wasSent(eventDate, reminderType)) {
    console.log(`Vote reminder already sent for ${eventDate}`);
    return;
  }

  const channel = await getChannel(client);
  if (!channel) return;

  try {
    const usersToRemind = getAttendeesWithUnrankedMovies(eventDate);

    if (usersToRemind.length === 0) {
      console.log('No attendees need vote reminders');
      reminders.markSent(eventDate, reminderType);
      return;
    }

    const mentions = usersToRemind.map(id => `<@${id}>`).join(' ');

    await channel.send(
      `🗳️ **Voting Reminder!**\n\n` +
      `${mentions}\n\n` +
      `Movie night is tomorrow! You still have movies to rank.\n` +
      `Click **Rank Movies** above to make your voice heard!`
    );

    reminders.markSent(eventDate, reminderType);
    console.log(`Vote reminder sent for ${eventDate}`);
  } catch (error) {
    console.error('Failed to send vote reminder:', error);
  }
}

/**
 * Send reminder to users who submitted/voted but haven't marked attendance.
 * Only sends once per event date.
 */
async function sendAttendanceReminder(client: Client): Promise<void> {
  const eventDate = getNextWednesday();
  const reminderType = 'attendance_reminder';

  // Check if already sent
  if (reminders.wasSent(eventDate, reminderType)) {
    console.log(`Attendance reminder already sent for ${eventDate}`);
    return;
  }

  const channel = await getChannel(client);
  if (!channel) return;

  try {
    const usersToRemind = getUsersWhoShouldMarkAttendance(eventDate);

    if (usersToRemind.length === 0) {
      console.log('No users need attendance reminders');
      reminders.markSent(eventDate, reminderType);
      return;
    }

    const mentions = usersToRemind.map(id => `<@${id}>`).join(' ');

    await channel.send(
      `📅 **Attendance Reminder!**\n\n` +
      `${mentions}\n\n` +
      `Movie night is tomorrow! If you're planning to attend, ` +
      `please mark your attendance above so we know to count your votes!`
    );

    reminders.markSent(eventDate, reminderType);
    console.log(`Attendance reminder sent for ${eventDate}`);
  } catch (error) {
    console.error('Failed to send attendance reminder:', error);
  }
}

/**
 * Announce the winning movie for movie night.
 * Only sends once per event date.
 */
async function announceWinner(client: Client): Promise<void> {
  const eventDate = getNextWednesday();
  const reminderType = 'winner_announcement';

  // Check if already sent
  if (reminders.wasSent(eventDate, reminderType)) {
    console.log(`Winner already announced for ${eventDate}`);
    return;
  }

  const channel = await getChannel(client);
  if (!channel) return;

  try {
    const rankings = computeCondorcetRanking();

    if (rankings.length === 0) {
      await channel.send(
        `🎬 **Movie Night Tonight!**\n\n` +
        `No movies in the queue. Submit some movies for next time!`
      );
      reminders.markSent(eventDate, reminderType);
      return;
    }

    const winner = rankings[0];
    const runnerUp = rankings.length > 1 ? rankings[1] : null;

    let message = `🎉 **Tonight's Movie Night Winner!**\n\n` +
      `🏆 **${winner.title}**\n` +
      `Wins: ${winner.wins} | Losses: ${winner.losses}`;

    if (runnerUp) {
      message += `\n\n🥈 Runner-up: **${runnerUp.title}**`;
    }

    message += `\n\nSee you tonight! 🍿`;

    await channel.send(message);

    reminders.markSent(eventDate, reminderType);
    console.log(`Winner announced for ${eventDate}: ${winner.title}`);
  } catch (error) {
    console.error('Failed to announce winner:', error);
  }
}

// Export for manual triggering if needed
export { sendVoteReminder, sendAttendanceReminder, announceWinner };
