import { Client, Guild, Role } from 'discord.js';
import { config } from '../config';
import { attendance, getNextWednesday } from '../database/queries';

const ROLE_NAME = 'watchers';

async function getOrCreateRole(guild: Guild): Promise<Role> {
  // Check if role already exists
  let role = guild.roles.cache.find(r => r.name === ROLE_NAME);

  if (!role) {
    // Create the role
    role = await guild.roles.create({
      name: ROLE_NAME,
      reason: 'Auto-created for movie night attendance tracking',
    });
    console.log(`Created "${ROLE_NAME}" role`);
  }

  return role;
}

export async function syncWatchersRole(client: Client): Promise<void> {
  try {
    const guild = await client.guilds.fetch(config.discord.guildId);
    if (!guild) {
      console.error('Guild not found');
      return;
    }

    const role = await getOrCreateRole(guild);
    const eventDate = getNextWednesday();
    const attendeeIds = attendance.getAttendees(eventDate);
    const attendeeSet = new Set(attendeeIds);

    // Fetch all members with the role
    await guild.members.fetch();

    // Add role to attendees who don't have it
    for (const userId of attendeeIds) {
      try {
        const member = await guild.members.fetch(userId);
        if (!member.roles.cache.has(role.id)) {
          await member.roles.add(role);
          console.log(`Added ${ROLE_NAME} role to ${member.user.tag}`);
        }
      } catch (error) {
        // User might not be in the guild
        console.warn(`Could not add role to user ${userId}:`, error);
      }
    }

    // Remove role from non-attendees who have it
    const membersWithRole = guild.members.cache.filter(m => m.roles.cache.has(role.id));
    for (const [memberId, member] of membersWithRole) {
      if (!attendeeSet.has(memberId)) {
        try {
          await member.roles.remove(role);
          console.log(`Removed ${ROLE_NAME} role from ${member.user.tag}`);
        } catch (error) {
          console.warn(`Could not remove role from user ${memberId}:`, error);
        }
      }
    }
  } catch (error) {
    console.error('Failed to sync watchers role:', error);
  }
}
