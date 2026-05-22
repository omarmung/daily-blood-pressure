import { Redis } from '@upstash/redis';

const redis = Redis.fromEnv();

export default async function handler(req, res) {
  const feedName = process.env.FEED_NAME;
  if (!feedName) return res.status(500).send('FEED_NAME env var is not set.');

  const existing = await redis.get(`bp:withings:refresh:${feedName}`);
  if (existing) {
    return res.status(400).send(
      `Feed "${feedName}" is already initialized. ` +
      `To reset, delete the KV key "bp:withings:refresh:${feedName}" manually.`
    );
  }

  const redirectUri = `https://${req.headers.host}/api/auth/callback`;
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: process.env.WITHINGS_CLIENT_ID,
    scope: 'user.metrics',
    redirect_uri: redirectUri,
    state: feedName,
  });

  res.redirect(`https://account.withings.com/oauth2_user/authorize2?${params}`);
}
