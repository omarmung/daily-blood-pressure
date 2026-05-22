# daily-blood-pressure

Subscribable calendar feed of your daily Withings blood pressure measurements. A cron job fetches your readings once a day and publishes them as a `.ics` file you can subscribe to in Apple Calendar, Fantastical, Google Calendar, or any other calendar app.

Each reading appears as an all-day event titled `120/80 mmHg (7:04 AM)` on the date you took the measurement.

**Stack:** Vercel (cron + blob storage) · Upstash Redis · Withings API

---

## What you need

- A [Withings](https://www.withings.com) blood pressure monitor and account
- A [Vercel](https://vercel.com) account (free Hobby plan is fine)
- Node.js 18 or later
- The [Vercel CLI](https://vercel.com/docs/cli): `npm i -g vercel`

---

## Setup

Clone the repo and install dependencies:

```sh
git clone https://github.com/your-username/daily-blood-pressure.git
cd daily-blood-pressure
npm install
```

Log in to Vercel if you haven't already:

```sh
vercel login
```

Run the setup script:

```sh
npm run setup
```

The script walks you through everything in six steps:

1. **Pick a project name** — determines your Vercel URL (e.g. `daily-bp-dustin` → `daily-bp-dustin.vercel.app`)
2. **Create a Withings developer app** — the script gives you the exact callback URL to register; make sure to check "Public API integration" when creating the app
3. **Configure your feed** — name, start date, and timezone
4. **Connect to Vercel** — links the project and sets all environment variables automatically
5. **Connect storage** — Upstash Redis (for OAuth tokens) and Vercel Blob (for the `.ics` file), both from the Vercel dashboard
6. **Deploy and authorize** — deploys the project and walks you through the Withings OAuth flow

Total time: about 5 minutes.

---

## Subscribing to the feed

At the end of `npm run setup`, the script prints your `.ics` URL directly. Copy it and subscribe in your calendar app:

- **Apple Calendar:** File → New Calendar Subscription → paste the URL
- **Fantastical:** File → New Calendar Subscription → paste the URL
- **Google Calendar:** Other calendars → From URL → paste the URL

The calendar app will poll the feed periodically and new readings will appear within a few hours of the cron running. The cron schedule is set in `vercel.json` — adjust it to fit your timezone.

---

## How it works

```
Vercel Cron (daily)
  → refreshes Withings OAuth token (stored in Upstash Redis)
  → fetches all blood pressure measurements since FEED_START_DATE
  → generates a .ics file with one all-day event per reading
  → overwrites bp-{name}.ics in Vercel Blob
```

Each reading session produces one calendar event. Readings with only systolic or only diastolic present are skipped.

### Multiple people

The codebase is designed for one Withings account per deployment. To run feeds for two people, deploy the repo twice with different `FEED_NAME` values and different Withings credentials. Both deployments can share the same Vercel Blob and Upstash Redis — the `FEED_NAME` namespaces all keys so there are no collisions.

---

## Environment variables

| Variable | Description |
|---|---|
| `WITHINGS_CLIENT_ID` | From your Withings developer app |
| `WITHINGS_CLIENT_SECRET` | From your Withings developer app |
| `FEED_NAME` | Short identifier, e.g. `dustin` — used in filenames and the calendar title |
| `FEED_START_DATE` | Earliest date to include, e.g. `2024-01-01` |
| `FEED_TIMEZONE` | IANA timezone name, e.g. `America/Los_Angeles` |
| `UPSTASH_REDIS_REST_URL` | Auto-provisioned when you connect Upstash Redis in Vercel |
| `UPSTASH_REDIS_REST_TOKEN` | Auto-provisioned when you connect Upstash Redis in Vercel |
| `BLOB_READ_WRITE_TOKEN` | Auto-provisioned when you connect Vercel Blob |
| `CRON_SECRET` | Auto-injected by Vercel to authenticate cron invocations |

The setup script sets all the manual variables for you. The auto-provisioned ones appear automatically once you connect the storage services in the Vercel dashboard.

---

## Roadmap

- **Append-only mode** — on first run, fetch all history back to `FEED_START_DATE`; on subsequent runs, only fetch measurements since the last sync. Reduces Withings API calls as history grows.
- **`/api/status` endpoint** — returns the last successful sync timestamp from Redis, so you can verify the cron is running without checking Vercel logs.
- **Input validation in setup script** — validate `FEED_START_DATE` format and `FEED_TIMEZONE` against the IANA database before setting env vars.
- **Custom domain support** — the setup script currently assumes a `.vercel.app` URL; it should handle custom domains gracefully.

---

## Re-authorizing

If your Withings token ever becomes invalid (e.g. after a long gap), visit:

```
https://your-project.vercel.app/api/auth
```

Before doing so, delete the `bp:withings:refresh:{FEED_NAME}` and `bp:withings:userid:{FEED_NAME}` keys from your Upstash Redis database, then complete the OAuth flow again.
