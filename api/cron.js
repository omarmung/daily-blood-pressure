import { Redis } from '@upstash/redis';
import { put } from '@vercel/blob';

const redis = Redis.fromEnv();

async function refreshAccessToken(feedName) {
  const storedRefresh = await redis.get(`bp:withings:refresh:${feedName}`);
  if (!storedRefresh) {
    throw new Error(`No refresh token in KV for feed "${feedName}". Visit /api/auth to set up.`);
  }

  const res = await fetch('https://wbsapi.withings.net/v2/oauth2', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      action: 'requesttoken',
      grant_type: 'refresh_token',
      client_id: process.env.WITHINGS_CLIENT_ID,
      client_secret: process.env.WITHINGS_CLIENT_SECRET,
      refresh_token: storedRefresh,
    }),
  });

  const json = await res.json();
  if (json.status !== 0) throw new Error(`Withings token refresh failed (status ${json.status})`);
  if (!json.body?.refresh_token) throw new Error(`Withings token refresh missing refresh_token: ${JSON.stringify(json)}`);
  if (!json.body?.access_token) throw new Error(`Withings token refresh missing access_token: ${JSON.stringify(json)}`);

  await redis.set(`bp:withings:refresh:${feedName}`, json.body.refresh_token);
  return json.body.access_token;
}

async function fetchMeasurements(accessToken, startDate, meastype) {
  const startUnix = Math.floor(new Date(`${startDate}T00:00:00Z`).getTime() / 1000);
  const all = [];
  let offset = null;

  do {
    const params = new URLSearchParams({
      action: 'getmeas',
      meastype: String(meastype),
      category: '1',
      startdate: String(startUnix),
      enddate: String(Math.floor(Date.now() / 1000)),
    });
    if (offset !== null) params.set('offset', String(offset));

    const res = await fetch('https://wbsapi.withings.net/v2/measure', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: params,
    });

    const text = await res.text();
    let data;
    try {
      data = JSON.parse(text);
    } catch {
      throw new Error(`Withings measurements response not JSON (HTTP ${res.status}): ${text.slice(0, 200)}`);
    }
    const { status, body } = data;
    if (status !== 0) throw new Error(`Withings measurements fetch failed (status ${status}): ${text}`);

    for (const grp of body.measuregrps) {
      for (const m of grp.measures) {
        all.push({ grpid: grp.grpid, date: grp.date, value: m.value * Math.pow(10, m.unit) });
      }
    }

    offset = body.more ? body.offset : null;
  } while (offset !== null);

  return all;
}

async function fetchReadings(accessToken, startDate) {
  const [diastolicMeas, systolicMeas] = await Promise.all([
    fetchMeasurements(accessToken, startDate, 9),
    fetchMeasurements(accessToken, startDate, 10),
  ]);

  const diastolicByGrp = new Map(diastolicMeas.map(m => [m.grpid, m]));
  const systolicByGrp = new Map(systolicMeas.map(m => [m.grpid, m]));

  const readings = [];

  for (const [grpid, systolic] of systolicByGrp) {
    const diastolic = diastolicByGrp.get(grpid);
    if (!diastolic) {
      console.warn(`Skipping grpid ${grpid}: systolic present but no diastolic`);
      continue;
    }
    readings.push({ grpid, date: systolic.date, systolic: systolic.value, diastolic: diastolic.value });
  }

  for (const [grpid] of diastolicByGrp) {
    if (!systolicByGrp.has(grpid)) {
      console.warn(`Skipping grpid ${grpid}: diastolic present but no systolic`);
    }
  }

  return readings;
}

function localDateAndTime(unix, timezone) {
  const d = new Date(unix * 1000);
  const localDate = d.toLocaleDateString('en-CA', { timeZone: timezone });
  const [y, mo, dy] = localDate.split('-').map(Number);

  const dtstart = `${y}${String(mo).padStart(2, '0')}${String(dy).padStart(2, '0')}`;
  const dtend = new Date(Date.UTC(y, mo - 1, dy + 1))
    .toISOString()
    .slice(0, 10)
    .replace(/-/g, '');

  const timeStr = d.toLocaleTimeString('en-US', {
    timeZone: timezone,
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });

  return { dtstart, dtend, timeStr };
}

function formatBP(systolic, diastolic) {
  return `${Math.round(systolic)}/${Math.round(diastolic)} mmHg`;
}

function buildIcs(readings, { feedName, timezone }) {
  const displayName = feedName[0].toUpperCase() + feedName.slice(1);
  readings.sort((a, b) => a.date - b.date);

  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//daily-blood-pressure//EN',
    `X-WR-CALNAME:Blood Pressure - ${displayName}`,
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
  ];

  for (const { grpid, date, systolic, diastolic } of readings) {
    const { dtstart, dtend, timeStr } = localDateAndTime(date, timezone);
    lines.push(
      'BEGIN:VEVENT',
      `DTSTART;VALUE=DATE:${dtstart}`,
      `DTEND;VALUE=DATE:${dtend}`,
      `SUMMARY:${formatBP(systolic, diastolic)} (${timeStr})`,
      `UID:bp-${feedName}-${grpid}@daily-blood-pressure`,
      'END:VEVENT',
    );
  }

  lines.push('END:VCALENDAR');
  return lines.join('\r\n') + '\r\n';
}

export default async function handler(req, res) {
  const validCron = req.headers.authorization === `Bearer ${process.env.CRON_SECRET}`;
  const validSetup = process.env.SETUP_TOKEN && req.query.setup_token === process.env.SETUP_TOKEN;
  if (!validCron && !validSetup) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const {
    FEED_NAME: feedName,
    FEED_START_DATE: startDate,
    FEED_TIMEZONE: timezone,
  } = process.env;

  if (!feedName) throw new Error('FEED_NAME is required');
  if (!startDate) throw new Error('FEED_START_DATE is required');
  if (!timezone) throw new Error('FEED_TIMEZONE is required');

  const accessToken = await refreshAccessToken(feedName);
  const readings = await fetchReadings(accessToken, startDate);
  const ics = buildIcs(readings, { feedName, timezone });

  const blob = await put(`bp-${feedName}.ics`, ics, {
    access: 'public',
    allowOverwrite: true,
    addRandomSuffix: false,
    contentType: 'text/calendar; charset=utf-8',
  });

  res.json({ ok: true, count: readings.length, url: blob.url });
}
