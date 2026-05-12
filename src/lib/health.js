#!/usr/bin/env node

const https = require('https');
const { createClient } = require('@supabase/supabase-js');
const ws = require('ws');
require('dotenv').config();

const NTFY_TOPIC = process.env.NTFY_TOPIC || 'uk-powercut-unofficial-status';

function getSupabase() {
  return createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    { realtime: { transport: ws } }
  );
}

function sendNtfy(title, message, priority, tags) {
  return new Promise((resolve) => {
    const body = JSON.stringify({ topic: NTFY_TOPIC, title, message, priority, tags });
    const req = https.request({
      hostname: 'ntfy.sh',
      port: 443,
      path: '/',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
      },
    }, (res) => resolve(res.statusCode));
    req.on('error', () => resolve(null)); // never let ntfy failure crash the scraper
    req.write(body);
    req.end();
  });
}

async function reportSuccess(scraper, recordsUpserted, durationMs) {
  const supabase = getSupabase();
  const { error } = await supabase.from('scraper_health').upsert({
    scraper,
    last_run: new Date().toISOString(),
    status: 'success',
    records_upserted: recordsUpserted,
    duration_ms: durationMs,
    error_message: null,
    updated_at: new Date().toISOString(),
  }, { onConflict: 'scraper' });
  if (error) console.error(`[health] Failed to write success for ${scraper}: ${error.message}`);
}

async function reportFailure(scraper, err, durationMs) {
  const supabase = getSupabase();
  const message = (err && err.message) ? err.message : String(err);
  const { error } = await supabase.from('scraper_health').upsert({
    scraper,
    last_run: new Date().toISOString(),
    status: 'failure',
    records_upserted: 0,
    duration_ms: durationMs,
    error_message: message,
    updated_at: new Date().toISOString(),
  }, { onConflict: 'scraper' });
  if (error) console.error(`[health] Failed to write failure for ${scraper}: ${error.message}`);
  await sendNtfy(`❌ ${scraper} scraper failed`, message, 'high', ['warning', 'rotating_light']);
}

module.exports = { reportSuccess, reportFailure };
