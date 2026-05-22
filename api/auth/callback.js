import { Redis } from '@upstash/redis';

const redis = Redis.fromEnv();

export default async function handler(req, res) {
  const { code, error } = req.query;

  if (error) return res.status(400).send(`Withings authorization error: ${error}`);
  // Withings pings the callback URL to verify it's reachable — return 200 for that check
  if (!code) return res.status(200).send('OK');

  const feedName = process.env.FEED_NAME;
  const redirectUri = `https://${req.headers.host}/api/auth/callback`;

  const tokenRes = await fetch('https://wbsapi.withings.net/v2/oauth2', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      action: 'requesttoken',
      grant_type: 'authorization_code',
      client_id: process.env.WITHINGS_CLIENT_ID,
      client_secret: process.env.WITHINGS_CLIENT_SECRET,
      code,
      redirect_uri: redirectUri,
    }),
  });

  const { status, body } = await tokenRes.json();
  if (status !== 0) {
    return res.status(500).send(`Withings token exchange failed (status ${status})`);
  }

  const { userid, refresh_token } = body;
  await redis.set(`bp:withings:userid:${feedName}`, userid);
  await redis.set(`bp:withings:refresh:${feedName}`, refresh_token);

  res.send(`<!DOCTYPE html>
<html>
<head><title>Setup complete</title></head>
<body>
  <h1>Setup complete</h1>
  <p>Feed <strong>${feedName}</strong> is ready. Withings user ID: <code>${userid}</code>.</p>
  <p>The cron job will generate your first .ics file on its next scheduled run.</p>
</body>
</html>`);
}
