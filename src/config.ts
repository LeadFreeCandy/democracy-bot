import 'dotenv/config';

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

export const config = {
  discord: {
    token: requireEnv('DISCORD_TOKEN'),
    clientId: requireEnv('DISCORD_CLIENT_ID'),
    guildId: requireEnv('DISCORD_GUILD_ID'),
    movieChannelId: requireEnv('MOVIE_CHANNEL_ID'),
  },
  ranking: {
    sessionTimeoutMs: 30 * 60 * 1000, // 30 minutes
  },
  scheduler: {
    timezone: 'America/New_York',
  },
};
