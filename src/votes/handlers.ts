import { ButtonInteraction, Client } from 'discord.js';
import {
  getVote,
  getVoteOptions,
  getOptionById,
  getVoterIds,
  deletePreferencesForUser,
  computeVoteResults,
  completeVote,
  getWinnerExplanation,
} from './database';
import {
  createVoteSession,
  getVoteSession,
  deleteVoteSession,
} from './session';
import { processVoteChoice, VoteChoice } from './binary-insertion';
import {
  VoteButtonIds,
  buildVoteComparisonMessage,
  buildVoteCompletionMessage,
  buildVotePanelMessage,
} from './components';
import { generateVoteGraph } from './scheduler';

export async function handleVoteButtonInteraction(
  interaction: ButtonInteraction,
  client: Client
): Promise<void> {
  const parts = interaction.customId.split(':');
  const action = parts[0];

  switch (action) {
    case VoteButtonIds.CAST:
      await handleCastVote(interaction, parseInt(parts[1]));
      return;
    case VoteButtonIds.PREFER_A:
      await handleVotePreference(interaction, 'a', parseInt(parts[2]), client);
      return;
    case VoteButtonIds.PREFER_B:
      await handleVotePreference(interaction, 'b', parseInt(parts[2]), client);
      return;
    case VoteButtonIds.NO_PREF:
      await handleVotePreference(interaction, 'tie', parseInt(parts[2]), client);
      return;
    case VoteButtonIds.CANCEL:
      await handleVoteCancel(interaction, parseInt(parts[2]));
      return;
    case VoteButtonIds.END:
      await handleEndVote(interaction, parseInt(parts[1]), parts[2], client);
      return;
  }
}

async function handleCastVote(interaction: ButtonInteraction, voteId: number): Promise<void> {
  const userId = interaction.user.id;
  const vote = getVote(voteId);

  if (!vote || vote.status !== 'active') {
    await interaction.reply({ content: 'This vote has closed.', ephemeral: true });
    return;
  }

  // Delete old preferences so user re-ranks from scratch
  deletePreferencesForUser(userId, voteId);

  // Clear any existing session for this vote
  deleteVoteSession(userId, voteId);

  const session = createVoteSession(userId, voteId);

  if (!session) {
    await interaction.reply({ content: 'Not enough options to compare.', ephemeral: true });
    return;
  }

  // If session completed immediately (only 1 option was unranked, auto-inserted)
  if (session.optionToInsert === 0) {
    deleteVoteSession(userId, voteId);
    await interaction.reply({ ...buildVoteCompletionMessage(), ephemeral: true });
    await updateVotePanel(interaction, voteId);
    return;
  }

  const optionA = getOptionById(session.optionToInsert);
  const optionB = getOptionById(session.sortedOptions[session.currentMid]);

  if (!optionA || !optionB) {
    await interaction.reply({ content: 'Error loading vote options.', ephemeral: true });
    return;
  }

  await interaction.reply({
    ...buildVoteComparisonMessage(session, optionA.label, optionB.label),
    ephemeral: true,
  });
}

async function handleVotePreference(
  interaction: ButtonInteraction,
  choice: VoteChoice,
  voteId: number,
  _client: Client
): Promise<void> {
  const userId = interaction.user.id;

  // Ownership check: button encodes the userId
  const parts = interaction.customId.split(':');
  const buttonOwnerId = parts[1];
  if (buttonOwnerId !== userId) {
    await interaction.reply({ content: "This isn't your session!", ephemeral: true });
    return;
  }

  const session = getVoteSession(userId, voteId);

  if (!session) {
    await interaction.update({
      content: 'Session expired. Click **Cast Vote** to start again.',
      embeds: [],
      components: [],
    });
    return;
  }

  const result = processVoteChoice(session, choice);

  if (result.done) {
    await interaction.update(buildVoteCompletionMessage());
    await updateVotePanel(interaction, voteId);
  } else {
    const optionA = getOptionById(session.optionToInsert);
    const optionB = getOptionById(session.sortedOptions[session.currentMid]);

    if (!optionA || !optionB) {
      await interaction.update({ content: 'Error loading vote options.', embeds: [], components: [] });
      return;
    }

    await interaction.update(buildVoteComparisonMessage(session, optionA.label, optionB.label));
  }
}

async function handleVoteCancel(interaction: ButtonInteraction, voteId: number): Promise<void> {
  const userId = interaction.user.id;
  deleteVoteSession(userId, voteId);
  await interaction.deferUpdate();
  await interaction.deleteReply().catch(() => {});
}

async function handleEndVote(
  interaction: ButtonInteraction,
  voteId: number,
  creatorId: string,
  client: Client
): Promise<void> {
  if (interaction.user.id !== creatorId) {
    await interaction.reply({ content: 'Only the vote creator can end this vote.', ephemeral: true });
    return;
  }

  const vote = getVote(voteId);
  if (!vote || vote.status !== 'active') {
    await interaction.reply({ content: 'This vote has already ended.', ephemeral: true });
    return;
  }

  // Mark complete — the scheduler's expiration handler will pick up the rest
  completeVote(voteId);

  // Compute results + graph
  const results = computeVoteResults(voteId);
  let graphBuffer: Buffer | undefined;
  try {
    graphBuffer = await generateVoteGraph(voteId);
  } catch {
    // Graph generation failed
  }

  // Post results
  const explanation = getWinnerExplanation(voteId);
  const { buildVoteResultsMessage } = await import('./components');
  await interaction.reply(buildVoteResultsMessage(vote, results, graphBuffer, explanation));

  // Update the panel to show closed
  await updateVotePanel(interaction, voteId);
}

async function updateVotePanel(interaction: ButtonInteraction, voteId: number): Promise<void> {
  const vote = getVote(voteId);
  if (!vote || !vote.message_id) return;

  try {
    const channel = interaction.guild?.channels.cache.get(vote.channel_id);
    if (!channel || !channel.isTextBased()) return;

    const message = await channel.messages.fetch(vote.message_id);
    const options = getVoteOptions(voteId);
    const voterIds = getVoterIds(voteId);
    await message.edit(buildVotePanelMessage(vote, options, voterIds));
  } catch {
    // Panel message may have been deleted
  }
}
