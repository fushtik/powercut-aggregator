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
    const msgBuf = Buffer.from(message, 'utf8');
    const req = https.request({
      hostname: 'ntfy.sh',
      port: 443,
      path: `/${NTFY_TOPIC}`,
      method: 'POST',
      headers: {
        'Content-Type': 'text/plain; charset=utf-8',
        'Content-Length': msgBuf.length,
        'Title': title,
        'X-Priority': priority,
        'X-Tags': Array.isArray(tags) ? tags.join(',') : tags,
      },
    }, (res) => resolve(res.statusCode));
    req.on('error', () => resolve(null)); // never let ntfy failure crash the scraper
    req.write(msgBuf);
    req.end();
  });
}

const ALERT_THRESHOLD = 3; // consecutive failures before ntfy alert fires

async function reportSuccess(scraper, recordsUpserted, durationMs) {
  const supabase = getSupabase();

  // Read previous state so we know if we're recovering from an alerted failure
  const { data: current } = await supabase
    .from('scraper_health')
    .select('consecutive_failures')
    .eq('scraper', scraper)
    .maybeSingle();

  const previousFailures = (current && current.consecutive_failures) || 0;

  const { error } = await supabase.from('scraper_health').upsert({
    scraper,
    last_run: new Date().toISOString(),
    status: 'success',
    records_upserted: recordsUpserted,
    duration_ms: durationMs,
    error_message: null,
    consecutive_failures: 0,
    updated_at: new Date().toISOString(),
  }, { onConflict: 'scraper' });
  if (error) console.error(`[health] Failed to write success for ${scraper}: ${error.message}`);

  if (previousFailures >= ALERT_THRESHOLD) {
    await sendNtfy(
      `${scraper} scraper recovered`,
      `Back to normal after ${previousFailures} consecutive failure${previousFailures !== 1 ? 's' : ''}.`,
      'default',
      ['white_check_mark']
    );
  }
}

async function reportFailure(scraper, err, durationMs) {
  const supabase = getSupabase();
  const message = (err && err.message) ? err.message : String(err);

  // Read current consecutive failure count before writing
  const { data: current } = await supabase
    .from('scraper_health')
    .select('consecutive_failures')
    .eq('scraper', scraper)
    .maybeSingle();

  const consecutiveFailures = ((current && current.consecutive_failures) || 0) + 1;

  const { error } = await supabase.from('scraper_health').upsert({
    scraper,
    last_run: new Date().toISOString(),
    status: 'failure',
    records_upserted: 0,
    duration_ms: durationMs,
    error_message: message,
    consecutive_failures: consecutiveFailures,
    updated_at: new Date().toISOString(),
  }, { onConflict: 'scraper' });
  if (error) console.error(`[health] Failed to write failure for ${scraper}: ${error.message}`);

  // Only alert once the threshold is reached, not on every subsequent failure
  if (consecutiveFailures === ALERT_THRESHOLD) {
    await sendNtfy(
      `${scraper} scraper failed (${ALERT_THRESHOLD} in a row)`,
      message,
      'high',
      ['warning', 'rotating_light']
    );
  }
}

module.exports = { reportSuccess, reportFailure };
