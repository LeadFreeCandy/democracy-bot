import {
  ActionRowBuilder,
  AttachmentBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
} from 'discord.js';
import { Vote, VoteOption, VoteResult } from './database';
import type { VoteSession } from './session';

export const VoteButtonIds = {
  CAST: 'vote_cast',
  PREFER_A: 'vote_prefer_a',
  PREFER_B: 'vote_prefer_b',
  NO_PREF: 'vote_no_pref',
  CANCEL: 'vote_cancel',
  END: 'vote_end',
} as const;

// --- Vote panel (public embed in channel) ---

export function buildVotePanelEmbed(vote: Vote, options: VoteOption[], voterIds: string[]): EmbedBuilder {
  const endsAtSec = Math.floor(vote.ends_at / 1000);
  const isClosed = vote.status === 'completed';

  const optionList = options.map((o, i) => `${i + 1}. ${o.label}`).join('\n');
  const voterCount = voterIds.length;

  let statusLine: string;
  if (isClosed) {
    statusLine = '**This vote has closed.**';
  } else {
    statusLine = `Ends <t:${endsAtSec}:R>`;
  }

  let voterLine = '';
  if (voterCount > 0) {
    const mentions = voterIds.map(id => `<@${id}>`).join(', ');
    voterLine = `\n\n**Voted (${voterCount}):** ${mentions}`;
  }

  const embed = new EmbedBuilder()
    .setTitle(vote.title)
    .setDescription(`**Options:**\n${optionList}\n\n${statusLine}${voterLine}`)
    .setColor(isClosed ? 0x99aab5 : 0x5865f2)
    .setFooter({ text: `Vote #${vote.id} · Created by` })
    .setTimestamp(vote.created_at);

  return embed;
}

export function buildVotePanelButtons(voteId: number, creatorId: string): ActionRowBuilder<ButtonBuilder>[] {
  return [new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(`${VoteButtonIds.CAST}:${voteId}`)
      .setLabel('Cast Vote')
      .setStyle(ButtonStyle.Primary)
      .setEmoji('🗳️'),
    new ButtonBuilder()
      .setCustomId(`${VoteButtonIds.END}:${voteId}:${creatorId}`)
      .setLabel('End Vote')
      .setStyle(ButtonStyle.Danger),
  )];
}

export function buildVotePanelClosedButtons(): ActionRowBuilder<ButtonBuilder>[] {
  return [new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId('vote_closed_noop')
      .setLabel('Vote Closed')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(true),
  )];
}

export function buildVotePanelMessage(vote: Vote, options: VoteOption[], voterIds: string[]) {
  const isClosed = vote.status === 'completed';
  return {
    embeds: [buildVotePanelEmbed(vote, options, voterIds)],
    components: isClosed ? buildVotePanelClosedButtons() : buildVotePanelButtons(vote.id, vote.creator_id),
  };
}

// --- Comparison prompt (ephemeral) ---

function truncateLabel(label: string, maxLength: number = 80): string {
  if (label.length <= maxLength) return label;
  return label.slice(0, maxLength - 3) + '...';
}

function estimateRemaining(session: VoteSession): number {
  const currentSearchSpace = session.high - session.low;
  let total = currentSearchSpace > 0 ? Math.ceil(Math.log2(currentSearchSpace)) : 0;
  const pending = session.pendingOptions.length;
  for (let i = 0; i < pending; i++) {
    total += Math.ceil(Math.log2(session.sortedOptions.length + i + 2));
  }
  return Math.max(total, 1);
}

export function buildVoteComparisonMessage(session: VoteSession, labelA: string, labelB: string) {
  const remaining = estimateRemaining(session);
  const optionsLeft = session.pendingOptions.length + 1;

  const embed = new EmbedBuilder()
    .setTitle('🗳️ Cast Your Vote')
    .setDescription(
      `**Which do you prefer?**\n\n` +
      `> **A.** ${labelA}\n` +
      `> **B.** ${labelB}\n\n` +
      `~${remaining} comparison${remaining === 1 ? '' : 's'} remaining · ${optionsLeft} option${optionsLeft === 1 ? '' : 's'} left`
    )
    .setColor(0x5865f2);

  const row1 = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(`${VoteButtonIds.PREFER_A}:${session.userId}:${session.voteId}`)
      .setLabel(truncateLabel(labelA))
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId(`${VoteButtonIds.PREFER_B}:${session.userId}:${session.voteId}`)
      .setLabel(truncateLabel(labelB))
      .setStyle(ButtonStyle.Primary),
  );

  const row2 = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(`${VoteButtonIds.NO_PREF}:${session.userId}:${session.voteId}`)
      .setLabel('No Preference')
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(`${VoteButtonIds.CANCEL}:${session.userId}:${session.voteId}`)
      .setLabel('Cancel')
      .setStyle(ButtonStyle.Secondary),
  );

  return {
    embeds: [embed],
    components: [row1, row2],
  };
}

// --- Completion (ephemeral) ---

export function buildVoteCompletionMessage() {
  return {
    embeds: [
      new EmbedBuilder()
        .setTitle('✅ Vote Recorded!')
        .setDescription('Your ranking has been saved. You can vote again to update it.')
        .setColor(0x57f287),
    ],
    components: [],
  };
}

// --- Results (public, posted when vote expires) ---

export function buildVoteResultsMessage(vote: Vote, results: VoteResult[], graphBuffer?: Buffer, explanation?: string) {
  const lines = results.map((r, i) => {
    const medal = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `${i + 1}.`;
    return `${medal} **${r.label}** (${r.wins}W-${r.losses}L)`;
  });

  let description = lines.join('\n') || 'No votes were cast.';
  if (explanation) {
    description += `\n\n${explanation}`;
  }

  const embed = new EmbedBuilder()
    .setTitle(`📊 Results: ${vote.title}`)
    .setDescription(description)
    .setColor(0x57f287)
    .setFooter({ text: `Vote #${vote.id}` })
    .setTimestamp(Date.now());

  const payload: {
    embeds: EmbedBuilder[];
    files?: AttachmentBuilder[];
  } = { embeds: [embed] };

  if (graphBuffer) {
    const attachment = new AttachmentBuilder(graphBuffer, { name: 'vote_results.png' });
    embed.setImage('attachment://vote_results.png');
    payload.files = [attachment];
  }

  return payload;
}
