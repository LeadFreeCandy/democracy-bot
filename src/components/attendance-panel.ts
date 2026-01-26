import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
} from 'discord.js';
import { attendance, getNextWednesday, formatEventDate } from '../database/queries';

export const AttendanceButtonIds = {
  ATTENDING: 'attendance_yes',
  NOT_ATTENDING: 'attendance_no',
} as const;

export function buildAttendanceEmbed(): EmbedBuilder {
  const eventDate = getNextWednesday();
  const formattedDate = formatEventDate(eventDate);
  const attendeeIds = attendance.getAttendees(eventDate);

  // Build attendee list - compact if few, vertical if many
  let attendeeDisplay: string;
  if (attendeeIds.length === 0) {
    attendeeDisplay = '*No one yet — be the first!*';
  } else if (attendeeIds.length <= 5) {
    attendeeDisplay = attendeeIds.map(id => `<@${id}>`).join('  ');
  } else {
    attendeeDisplay = attendeeIds.map(id => `<@${id}>`).join('\n');
  }

  const countText = attendeeIds.length === 1 ? '1 person' : `${attendeeIds.length} people`;

  return new EmbedBuilder()
    .setTitle(`🍿 Movie Night — ${formattedDate}`)
    .setDescription(
      `**Your votes only count if you're attending!**\n` +
      `Let us know if you're coming so we pick a movie everyone will enjoy.\n\n` +
      `**Who's in? (${countText})**\n${attendeeDisplay}`
    )
    .setColor(0xfee75c);
}

export function buildAttendanceButtons(): ActionRowBuilder<ButtonBuilder> {
  return new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(AttendanceButtonIds.ATTENDING)
      .setLabel("I'm In!")
      .setStyle(ButtonStyle.Primary)
      .setEmoji('✋'),
    new ButtonBuilder()
      .setCustomId(AttendanceButtonIds.NOT_ATTENDING)
      .setLabel('Not This Week')
      .setStyle(ButtonStyle.Success)
      .setEmoji('👋'),
  );
}

export function buildAttendancePanelMessage() {
  return {
    embeds: [buildAttendanceEmbed()],
    components: [buildAttendanceButtons()],
  };
}
