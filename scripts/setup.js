#!/usr/bin/env node
/**
 * Interactive setup for daily-weight.
 * Run: node scripts/setup.js
 *
 * Prerequisites: Vercel CLI installed (npm i -g vercel) and logged in (vercel login).
 */

import { createInterface } from 'node:readline/promises';
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { stdin, stdout, exit } from 'node:process';

const rl = createInterface({ input: stdin, output: stdout });

function prompt(question) {
  return rl.question(`  ${question} `);
}

async function promptRequired(question) {
  while (true) {
    const value = (await prompt(question)).trim();
    if (value) return value;
    console.log('  (required — please enter a value)');
  }
}

async function promptDefault(question, defaultValue) {
  const value = (await prompt(`${question} (default: ${defaultValue})`)).trim();
  return value || defaultValue;
}

function pause(message) {
  return rl.question(`\n  ${message}\n\n  Press Enter to continue... `);
}

function vercelCLI(args, opts = {}) {
  return spawnSync('vercel', args, { encoding: 'utf8', ...opts });
}

function setEnv(name, value) {
  // Remove first in case it already exists — ignore errors
  vercelCLI(['env', 'rm', name, 'production', '--yes']);

  const result = vercelCLI(['env', 'add', name, 'production'], {
    input: value + '\n',
  });

  if (result.status !== 0) {
    throw new Error(result.stderr?.trim() || result.stdout?.trim() || 'unknown error');
  }
}

function hr() {
  console.log('\n' + '─'.repeat(60) + '\n');
}

async function main() {
  console.log('\ndaily-blood-pressure — setup\n');
  console.log('This script will configure your Withings blood pressure feed on Vercel.');
  console.log('It takes about 5 minutes.\n');

  // Check Vercel CLI
  if (vercelCLI(['--version']).status !== 0) {
    console.error('Vercel CLI not found. Install it first:\n\n  npm i -g vercel && vercel login\n');
    exit(1);
  }

  // ── Step 1: Project name ────────────────────────────────────
  hr();
  console.log('Step 1 of 6: Vercel project name\n');
  console.log('  Pick a name for your Vercel project. It determines your URL:');
  console.log('  https://{project-name}.vercel.app\n');
  console.log('  Example: daily-weight-dustin\n');

  const projectName = await promptRequired('Project name:');
  const projectUrl = `https://${projectName}.vercel.app`;
  const callbackUrl = `${projectUrl}/api/auth/callback`;

  // ── Step 2: Withings developer app ─────────────────────────
  hr();
  console.log('Step 2 of 6: Create a Withings developer app\n');
  console.log('  You need a Withings developer app to get API credentials.\n');
  console.log('  1. Open this URL in your browser:');
  console.log('\n     https://developer.withings.com/dashboard/\n');
  console.log('  2. Create a new application');
  console.log('  3. Check the box for "Public API integration"');
  console.log('     (This lets the app read your measurements via the Withings Data API)');
  console.log('  4. When asked for a callback / redirect URL, enter:\n');
  console.log(`     ${callbackUrl}\n`);
  await pause('Open the Withings developer portal and create your app, then come back here.');

  const clientId = await promptRequired('Withings Client ID:');
  const clientSecret = await promptRequired('Withings Client Secret:');

  // ── Step 3: Feed config ─────────────────────────────────────
  hr();
  console.log('Step 3 of 6: Feed configuration\n');

  console.log('  Feed name — used in the .ics filename and calendar title.');
  console.log('  Example: "dustin" → bp-dustin.ics, "Blood Pressure - Dustin"\n');
  const feedName = await promptRequired('Feed name (e.g. dustin):');

  console.log('\n  Start date — earliest weight measurement to include in the feed.');
  console.log('  Format: YYYY-MM-DD  Example: 2024-01-01\n');
  const startDate = await promptRequired('Start date:');

  console.log('\n  Timezone — used to display measurement times in event titles.');
  console.log('  Must be an IANA timezone name.');
  console.log('  Examples: America/Los_Angeles, America/New_York, Europe/London\n');
  const timezone = await promptRequired('Timezone:');

  // ── Step 4: Link + set env vars ─────────────────────────────
  hr();
  console.log('Step 4 of 6: Connect to Vercel\n');

  if (!existsSync('.vercel/project.json')) {
    console.log(`  Linking this directory to Vercel. When asked for the project name, use:\n\n    ${projectName}\n`);
    const linkResult = vercelCLI(['link'], { stdio: 'inherit' });
    if (linkResult.status !== 0) {
      console.error('\n  Linking failed. Try running `vercel login` first, then re-run this script.');
      exit(1);
    }
  } else {
    console.log('  Already linked to Vercel.\n');
  }

  console.log('\n  Setting environment variables...\n');
  const setupToken = randomBytes(32).toString('hex');
  const vars = [
    ['WITHINGS_CLIENT_ID', clientId],
    ['WITHINGS_CLIENT_SECRET', clientSecret],
    ['FEED_NAME', feedName],
    ['FEED_START_DATE', startDate],
    ['FEED_TIMEZONE', timezone],
    ['SETUP_TOKEN', setupToken],
  ];

  for (const [name, value] of vars) {
    try {
      setEnv(name, value);
      console.log(`  set  ${name}`);
    } catch (e) {
      console.error(`\n  Failed to set ${name}: ${e.message}`);
      console.error('  Make sure you are logged in: vercel login');
      exit(1);
    }
  }

  // ── Step 5: Storage ─────────────────────────────────────────
  hr();
  console.log('Step 5 of 6: Storage setup\n');
  console.log('  You need to connect two storage services to your Vercel project.\n');
  console.log('  Open your project in the Vercel dashboard:');
  console.log(`\n     https://vercel.com/dashboard\n`);
  console.log('  Then click "Storage" in the sidebar and connect both:\n');
  console.log('  1. Upstash Redis  — stores your Withings OAuth tokens');
  console.log('     Click "Create Database" → choose Upstash Redis\n');
  console.log('  2. Vercel Blob    — hosts the .ics file');
  console.log('     Click "Create Store" → choose Blob\n');
  console.log('  Both will auto-populate their credentials as environment variables.\n');
  await pause('Connect both storage services in the Vercel dashboard, then come back.');

  // ── Step 6: Deploy + auth ───────────────────────────────────
  hr();
  console.log('Step 6 of 6: Deploy and authorize\n');
  console.log('  Deploying to Vercel...\n');

  const deployResult = vercelCLI(['deploy', '--prod'], { stdio: 'inherit' });
  if (deployResult.status !== 0) {
    console.error('\n  Deployment failed. Check the output above.');
    exit(1);
  }

  console.log('\n  Now authorize the app to access your Withings data.\n');
  console.log('  Open this URL in your browser:\n');
  console.log(`     ${projectUrl}/api/auth\n`);
  console.log('  Log in to Withings and click Authorize.');
  console.log('  You should see a "Setup complete" confirmation page.\n');
  await pause('Complete the Withings authorization, then come back.');

  // ── Generate first feed ─────────────────────────────────────
  console.log('\n  Generating your first weight feed...\n');
  let feedUrl = null;
  try {
    const response = await fetch(`${projectUrl}/api/cron?setup_token=${setupToken}`);
    const data = await response.json();
    if (data.ok) {
      feedUrl = data.url;
      console.log(`  Done — ${data.count} weight events written.\n`);
    } else {
      console.log(`  Cron returned an error: ${JSON.stringify(data)}`);
    }
  } catch (e) {
    console.log(`  Could not reach cron endpoint: ${e.message}`);
  }

  // Remove setup token now that it has been used
  vercelCLI(['env', 'rm', 'SETUP_TOKEN', 'production', '--yes']);

  // ── Done ────────────────────────────────────────────────────
  hr();
  console.log('Setup complete!\n');
  if (feedUrl) {
    console.log('  Your .ics feed URL:\n');
    console.log(`     ${feedUrl}\n`);
    console.log('  Subscribe in Apple Calendar:');
    console.log('  File → New Calendar Subscription → paste the URL above\n');
  } else {
    console.log('  The feed could not be generated automatically.');
    console.log('  Visit your Vercel dashboard → your project → Cron Jobs and trigger it manually.\n');
  }
  console.log('  The feed updates daily at the schedule configured in vercel.json.\n');

  rl.close();
}

main().catch(e => {
  console.error(`\nSetup failed: ${e.message}\n`);
  exit(1);
});
