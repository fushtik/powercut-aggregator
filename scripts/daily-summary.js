#!/usr/bin/env node

const https = require('https');
const { createClient } = require('@supabase/supabase-js');
const ws = require('ws');
require('dotenv').config();

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { realtime: { transport: ws } }
);

const NTFY_TOPIC = process.env.NTFY_TOPIC || 'uk-powercut-unofficial-status';
const SCRAPER_ORDER = ['UKPN', 'SSEN', 'Northern Powergrid', 'SPE', 'NGED', 'NIE', 'ENWL'];

function timeAgo(iso) {
  const mins = Math.floor((Date.now() - new Date(iso)) / 60000);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  const rem = mins % 60;
  return rem > 0 ? `${hrs}h ${rem}m ago` : `${hrs}h ago`;
}

async function main() {
  const { data, error } = await supabase
    .from('scraper_health')
    .select('*');

  if (error) {
    console.error(`Failed to read scraper_health: ${error.message}`);
    process.exit(1);
  }

  const healthMap = Object.fromEntries((data || []).map(r => [r.scraper, r]));

  const lines = SCRAPER_ORDER.map(name => {
    const h = healthMap[name];
    if (!h) return `• ${name}: no data yet`;
    const icon = h.status === 'success' ? '✅' : '❌';
    const ago = timeAgo(h.last_run);
    const dur = `${(h.duration_ms / 1000).toFixed(1)}s`;
    return h.status === 'success'
      ? `${icon} ${name}: ${h.records_upserted} records (${dur}, ${ago})`
      : `${icon} ${name}: FAILED — ${h.error_message || 'unknown'} (${ago})`;
  });

  const allOk = SCRAPER_ORDER.every(name => healthMap[name]?.status === 'success');
  const title = allOk ? '✅ All scrapers healthy' : '⚠️ Some scrapers need attention';
  const message = lines.join('\n');

  console.log(title);
  console.log(message);

  const msgBuf = Buffer.from(message, 'utf8');

  await new Promise((resolve) => {
    const req = https.request({
      hostname: 'ntfy.sh',
      port: 443,
      path: `/${NTFY_TOPIC}`,
      method: 'POST',
      headers: {
        'Content-Type': 'text/plain; charset=utf-8',
        'Content-Length': msgBuf.length,
        'Title': title,
        'Priority': allOk ? 'default' : 'high',
        'Tags': allOk ? 'white_check_mark' : 'warning',
      },
    }, (res) => {
      let resBody = '';
      res.on('data', chunk => { resBody += chunk; });
      res.on('end', () => {
        console.log(`ntfy response: ${res.statusCode}`);
        if (res.statusCode !== 200) console.error(`ntfy error body: ${resBody}`);
        resolve();
      });
    });
    req.on('error', (e) => { console.error(`ntfy error: ${e.message}`); resolve(); });
    req.write(msgBuf);
    req.end();
  });

  process.exit(0);
}

main().catch(err => {
  console.error(err.message);
  process.exit(1);
});
