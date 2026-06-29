const express = require('express');
const fs = require('fs');
const path = require('path');

const app = express();
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

const DATA_DIR = process.env.DATA_DIR || '/app/data';
const PORT = process.env.PORT || 3099;
const CONFIG_PATH = path.join(DATA_DIR, 'config.json');
const STATE_PATH  = path.join(DATA_DIR, 'state.json');

const REDIRECT_URI = process.env.REDIRECT_URI;
if (!REDIRECT_URI) {
  console.error('ERROR: REDIRECT_URI env var is not set.');
  console.error('e.g. REDIRECT_URI=http://192.168.1.10:3099/callback');
  process.exit(1);
}

const RAW_CLIENT_ID  = process.env.TRUELAYER_CLIENT_ID || '';
const CLIENT_SECRET  = process.env.TRUELAYER_CLIENT_SECRET || '';
const ACTUAL_URL     = process.env.ACTUAL_SERVER_URL || '';
const ACTUAL_PASS    = process.env.ACTUAL_SERVER_PASSWORD || '';
const SANDBOX = (process.env.TRUELAYER_ENV || '').toLowerCase() === 'sandbox';

const CLIENT_ID = SANDBOX && RAW_CLIENT_ID && !RAW_CLIENT_ID.startsWith('sandbox-')
  ? 'sandbox-' + RAW_CLIENT_ID
  : RAW_CLIENT_ID;

const AUTH_URL  = SANDBOX ? 'https://auth.truelayer-sandbox.com' : 'https://auth.truelayer.com';
const API_URL   = SANDBOX ? 'https://api.truelayer-sandbox.com'  : 'https://api.truelayer.com';
const PROVIDERS = SANDBOX ? 'uk-cs-mock' : 'uk-ob-all uk-oauth-all';

console.log('Mode:         ' + (SANDBOX ? 'SANDBOX' : 'LIVE'));
console.log('Client ID:    ' + (CLIENT_ID || '(not set)'));
console.log('Auth:         ' + AUTH_URL);
console.log('Redirect URI: ' + REDIRECT_URI);

// ── Helpers ───────────────────────────────────────────────────────────────────

function maskSecret(s) {
  if (!s) return '(not set)';
  if (s.length <= 8) return '****';
  return s.slice(0, 4) + '...' + s.slice(-4);
}

function loadConfig() {
  if (!fs.existsSync(CONFIG_PATH)) return { version: 2, connections: [] };
  try {
    const raw = fs.readFileSync(CONFIG_PATH, 'utf8').trim();
    if (!raw) return { version: 2, connections: [] };
    return JSON.parse(raw);
  } catch (e) {
    console.warn('config.json unreadable, using defaults:', e.message);
    return { version: 2, connections: [] };
  }
}
function saveConfig(cfg) {
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(cfg, null, 2));
}
function loadState() {
  if (!fs.existsSync(STATE_PATH)) return { connections: {} };
  try {
    const raw = fs.readFileSync(STATE_PATH, 'utf8').trim();
    if (!raw) return { connections: {} };
    return JSON.parse(raw);
  } catch (e) {
    console.warn('state.json unreadable, using defaults:', e.message);
    return { connections: {} };
  }
}
function saveState(st) {
  fs.writeFileSync(STATE_PATH, JSON.stringify(st, null, 2));
}

function lastSyncedFor(connState) {
  if (!connState || !connState.accounts) return null;
  const dates = Object.values(connState.accounts)
    .map(function(a) { return a.lastSyncDate; })
    .filter(Boolean)
    .sort();
  return dates.length ? dates[dates.length - 1] : null;
}

function relativeTime(isoDate) {
  if (!isoDate) return null;
  const diffMs = Date.now() - new Date(isoDate).getTime();
  if (isNaN(diffMs)) return isoDate;
  const mins  = Math.floor(diffMs / 60000);
  const hours = Math.floor(mins  / 60);
  const days  = Math.floor(hours / 24);
  if (mins  <  2)  return 'just now';
  if (mins  < 60)  return mins  + ' minute'  + (mins  !== 1 ? 's' : '') + ' ago';
  if (hours < 24)  return hours + ' hour'    + (hours !== 1 ? 's' : '') + ' ago';
  if (days  < 30)  return days  + ' day'     + (days  !== 1 ? 's' : '') + ' ago';
  return new Date(isoDate).toLocaleDateString();
}

function uniqueConnName(base, existingConnections) {
  const existing = new Set(existingConnections.map(function(c) { return c.name; }));
  if (!existing.has(base)) return base;
  let i = 2;
  while (existing.has(base + '-' + i)) i++;
  return base + '-' + i;
}

function buildRows(savedAccounts, liveAccounts) {
  if (liveAccounts) {
    const rows = liveAccounts.map(function(acc) {
      const saved = savedAccounts.find(function(a) { return a.trueLayerId === acc.account_id; });
      const defaultName = acc.display_name || acc.account_type || '';
      return {
        trueLayerId: acc.account_id,
        displayName: defaultName,
        actualId: saved ? saved.actualId : '',
        friendlyName: saved ? saved.friendlyName : defaultName,
        flip: saved ? !!saved.flip : false,
        stale: false,
      };
    });
    savedAccounts.forEach(function(saved) {
      if (!liveAccounts.find(function(a) { return a.account_id === saved.trueLayerId; })) {
        rows.push({
          trueLayerId: saved.trueLayerId,
          displayName: saved.friendlyName || saved.trueLayerId,
          actualId: saved.actualId,
          friendlyName: saved.friendlyName,
          flip: !!saved.flip,
          stale: true,
        });
      }
    });
    return rows;
  }
  if (savedAccounts.length === 0) return [];
  return savedAccounts.map(function(saved) {
    return {
      trueLayerId: saved.trueLayerId,
      displayName: saved.friendlyName || saved.trueLayerId,
      actualId: saved.actualId,
      friendlyName: saved.friendlyName,
      flip: !!saved.flip,
      stale: false,
    };
  });
}

/** Exchange a refresh token for a new access token, persisting any rotated token. */
async function getAccessToken(connName, connState) {
  const tokenRes = await fetch(AUTH_URL + '/connect/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
      refresh_token: connState.refreshToken,
    }),
  });
  const tokenData = await tokenRes.json();
  if (!tokenData.access_token) throw new Error('Token refresh failed: ' + JSON.stringify(tokenData));
  if (tokenData.refresh_token) {
    connState.refreshToken = tokenData.refresh_token;
    const state = loadState();
    if (state.connections[connName]) {
      state.connections[connName].refreshToken = tokenData.refresh_token;
      saveState(state);
    }
  }
  return tokenData.access_token;
}

// ── Shared CSS ────────────────────────────────────────────────────────────────
const SHARED_CSS = `
  *, *::before, *::after { box-sizing: border-box; }
  body { font-family: system-ui, -apple-system, sans-serif; max-width: 900px; margin: 0 auto; padding: 24px 20px 60px; background: #f5f5f5; color: #1a1a1a; }
  h1 { margin: 0 0 4px; font-size: 1.4em; }
  h2 { font-size: 1.1em; margin: 0 0 12px; }
  a { color: #0066cc; }
  code { background: #eee; padding: 2px 5px; border-radius: 3px; font-size: 0.9em; font-family: monospace; }
  pre { background: #f0f0f0; padding: 12px; border-radius: 4px; font-size: 0.88em; overflow-x: auto; }
  .card { background: #fff; border: 1px solid #ddd; border-radius: 8px; padding: 16px 20px; margin: 10px 0; }
  .tag { display: inline-block; padding: 2px 9px; border-radius: 12px; font-size: 0.78em; font-weight: 600;
         background: #e8f0fe; color: #1a73e8; margin-left: 6px; vertical-align: middle; }
  .notice { padding: 11px 14px; border-radius: 6px; margin-bottom: 16px; font-size: 0.9em; line-height: 1.6; }
  .notice.success { background: #e6f4ea; border-left: 4px solid #137333; color: #137333; }
  .notice.error   { background: #fce8e6; border-left: 4px solid #c5221f; color: #9b1c1c; }
  .notice.info    { background: #fef7e0; border-left: 4px solid #f9ab00; color: #7a5c00; }
  .notice.warn    { background: #fff8e1; border-left: 4px solid #e65100; color: #7a3800; }
  .btn { display: inline-block; padding: 7px 16px; border-radius: 5px; font-size: 0.88em; font-weight: 600;
         text-decoration: none; cursor: pointer; border: none; margin-right: 6px; }
  .btn-primary { background: #0066cc; color: #fff; }
  .btn-primary:hover { background: #0052a3; }
  .btn-secondary { background: #555; color: #fff; }
  .btn-secondary:hover { background: #333; }
  .btn-danger { background: #c5221f; color: #fff; }
  .btn-danger:hover { background: #9b1c1c; }
  .btn-ghost { background: #eee; color: #333; }
  .btn-ghost:hover { background: #ddd; }
  .btn-green { background: #137333; color: #fff; }
  .btn-green:hover { background: #0a5227; }
  .mode-badge { display: inline-block; padding: 3px 10px; border-radius: 12px; font-weight: 700;
    font-size: 0.8em; margin-left: 8px; vertical-align: middle; }
  .modal-overlay { display:none; position:fixed; inset:0; background:rgba(0,0,0,0.45); z-index:100; align-items:center; justify-content:center; }
  .modal-overlay.open { display:flex; }
  .modal { background:#fff; border-radius:10px; padding:24px 28px; max-width:400px; width:90%; box-shadow:0 8px 32px rgba(0,0,0,0.18); }
  .modal h3 { margin:0 0 10px; }
  .modal p  { margin:0 0 20px; font-size:0.9em; color:#555; }
  .modal-actions { display:flex; gap:10px; justify-content:flex-end; }
  table.env-table { width:100%; border-collapse:collapse; font-size:0.88em; }
  table.env-table td { padding:5px 8px; }
  table.env-table td:first-child { font-weight:600; color:#555; width:140px; white-space:nowrap; }
  .security-banner { background:#fff3e0; border:1px solid #ff9800; border-radius:6px; padding:10px 14px;
    font-size:0.85em; color:#7a3800; margin-bottom:18px; line-height:1.6; }
  .security-banner strong { color:#e65100; }
  .last-synced { font-size:0.8em; color:#666; margin-top:4px; }
  .last-synced.overdue { color:#c5221f; font-weight:600; }
  .balance-grid { display:grid; grid-template-columns:repeat(auto-fill,minmax(260px,1fr)); gap:12px; margin-bottom:28px; }
  .balance-card { background:#fff; border:1px solid #ddd; border-radius:8px; padding:14px 18px; }
  .balance-card .acc-name { font-weight:600; font-size:0.95em; margin-bottom:2px; }
  .balance-card .acc-id   { font-size:0.75em; color:#888; margin-bottom:10px; font-family:monospace; }
  .balance-card .bal-row  { display:flex; justify-content:space-between; align-items:baseline; font-size:0.88em; margin-top:4px; }
  .balance-card .bal-label { color:#666; }
  .balance-card .bal-amount { font-weight:700; font-size:1.05em; }
  .balance-card .bal-amount.positive { color:#137333; }
  .balance-card .bal-amount.negative { color:#c5221f; }
  .txn-table { width:100%; border-collapse:collapse; font-size:0.85em; }
  .txn-table th { background:#f0f0f0; padding:8px 10px; border:1px solid #ddd; text-align:left; white-space:nowrap; }
  .txn-table td { padding:7px 10px; border:1px solid #eee; vertical-align:top; }
  .txn-table tr:hover td { background:#fafafa; }
  .txn-table .amt-credit { color:#137333; font-weight:600; text-align:right; white-space:nowrap; }
  .txn-table .amt-debit  { color:#c5221f; font-weight:600; text-align:right; white-space:nowrap; }
  .txn-table .amt-zero   { color:#888; text-align:right; white-space:nowrap; }
  .txn-section { margin-bottom:32px; }
  .txn-section h3 { font-size:1em; margin:0 0 8px; }
  .spinner { display:inline-block; width:18px; height:18px; border:3px solid #ccc;
             border-top-color:#0066cc; border-radius:50%; animation:spin 0.7s linear infinite; vertical-align:middle; margin-right:6px; }
  @keyframes spin { to { transform:rotate(360deg); } }
`;

function page(title, body) {
  return '<!DOCTYPE html><html lang="en">\n'
    + '<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">\n'
    + '<title>' + title + ' \u2014 TrueLayer Setup</title>\n'
    + '<style>' + SHARED_CSS + '</style>\n'
    + '</head><body>' + body + '</body></html>';
}

// ── Balances page client-side script (kept as a plain string to avoid nested backticks) ──
const BALANCES_SCRIPT = `
<script>
  async function loadData() {
    var btn    = document.getElementById('refreshBtn');
    var status = document.getElementById('fetchStatus');
    btn.disabled = true;
    btn.textContent = '\u27f3 Refreshing\u2026';
    status.textContent = '';
    document.getElementById('content').innerHTML =
      '<div style="padding:40px;text-align:center;color:#666"><span class="spinner"></span> Fetching\u2026</div>';

    try {
      var res  = await fetch(window.__apiUrl);
      var data = await res.json();
      if (data.error) throw new Error(data.error);
      renderData(data);
      status.textContent = 'Updated ' + new Date().toLocaleTimeString();
    } catch (e) {
      document.getElementById('content').innerHTML =
        '<div class="notice error">\u26a0\ufe0f ' + e.message + '</div>';
    } finally {
      btn.disabled = false;
      btn.textContent = '\u27f3 Refresh data';
    }
  }

  function fmt(amount, currency) {
    if (amount == null) return '\u2014';
    var syms = { GBP: '\u00a3', EUR: '\u20ac', USD: '$' };
    var sym  = syms[currency] || (currency + ' ');
    return sym + Math.abs(amount).toLocaleString('en-GB', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  function amtClass(amount) {
    if (!amount) return 'amt-zero';
    return amount > 0 ? 'amt-credit' : 'amt-debit';
  }

  function renderData(data) {
    var html = '<div class="balance-grid">';

    data.accounts.forEach(function(acc) {
      var b   = acc.balance;
      var cur = b ? fmt(b.current, b.currency) : '\u2014';
      var avl = (b && b.available != null) ? fmt(b.available, b.currency) : null;
      var cls = (b && b.current != null) ? (b.current >= 0 ? 'positive' : 'negative') : '';

      html += '<div class="balance-card">'
            +   '<div class="acc-name">' + (acc.friendlyName || acc.displayName) + '</div>'
            +   '<div class="acc-id">'   + acc.trueLayerId + '</div>'
            +   '<div class="bal-row"><span class="bal-label">Current balance</span>'
            +     '<span class="bal-amount ' + cls + '">' + cur + '</span></div>';
      if (avl != null) {
        html += '<div class="bal-row"><span class="bal-label">Available</span>'
              +   '<span class="bal-amount">' + avl + '</span></div>';
      }
      if (acc.balanceError) {
        html += '<div style="font-size:0.78em;color:#c5221f;margin-top:6px">\u26a0\ufe0f ' + acc.balanceError + '</div>';
      }
      html += '</div>';
    });

    html += '</div>';

    data.accounts.forEach(function(acc) {
      var txns = acc.transactions || [];
      html += '<div class="txn-section"><h3>\ud83d\udccb ' + (acc.friendlyName || acc.displayName)
            + ' \u2014 recent transactions (' + txns.length + ')</h3>';

      if (acc.txnError) {
        html += '<div class="notice error" style="font-size:0.88em">\u26a0\ufe0f ' + acc.txnError + '</div>';
      } else if (txns.length === 0) {
        html += '<p style="color:#888;font-size:0.88em">No transactions found.</p>';
      } else {
        html += '<div style="overflow-x:auto"><table class="txn-table">'
              + '<thead><tr><th>Date</th><th>Description</th><th>Category</th><th>Amount</th><th>Running balance</th></tr></thead>'
              + '<tbody>';
        txns.forEach(function(t) {
          var date   = t.timestamp ? t.timestamp.slice(0, 10) : '\u2014';
          var desc   = t.description || t.merchant_name || '\u2014';
          var cat    = t.transaction_category || '\u2014';
          var cls2   = amtClass(t.amount);
          var sign   = t.amount > 0 ? '+' : '';
          var amt    = t.amount != null ? sign + fmt(t.amount, t.currency) : '\u2014';
          var runBal = (t.running_balance != null) ? fmt(t.running_balance.amount, t.running_balance.currency) : '\u2014';
          html += '<tr>'
                + '<td style="white-space:nowrap">' + date + '</td>'
                + '<td>' + desc + '</td>'
                + '<td style="color:#666;font-size:0.9em">' + cat + '</td>'
                + '<td class="' + cls2 + '">' + amt + '</td>'
                + '<td style="color:#666;text-align:right;white-space:nowrap">' + runBal + '</td>'
                + '</tr>';
        });
        html += '</tbody></table></div>';
      }
      html += '</div>';
    });

    document.getElementById('content').innerHTML = html;
  }

  loadData();
</script>`;

function renderMappingPage(name, conn, rows, notice) {
  const allIds = rows.map(function(r) { return r.trueLayerId; }).join(',');

  const tableRows = rows.map(function(r) {
    return '<tr' + (r.stale ? ' style="opacity:0.55"' : '') + '>'
      + '<td>' + r.displayName + (r.stale ? ' <span class="tag" style="background:#fce8e6;color:#c5221f">not in live list</span>' : '') + '</td>'
      + '<td><code style="font-size:0.78em">' + r.trueLayerId + '</code></td>'
      + '<td><input style="width:100%;padding:5px;border:1px solid #ccc;border-radius:3px"'
      +      ' name="actualId_' + r.trueLayerId + '" value="' + r.actualId + '" placeholder="Paste Actual account ID"></td>'
      + '<td><input style="width:100%;padding:5px;border:1px solid #ccc;border-radius:3px"'
      +      ' name="friendlyName_' + r.trueLayerId + '" value="' + r.friendlyName + '" placeholder="e.g. Main Current Account"></td>'
      + '<td style="text-align:center"><input type="checkbox" name="flip_' + r.trueLayerId + '" ' + (r.flip ? 'checked' : '') + '></td>'
      + '</tr>';
  }).join('');

  const emptyState = rows.length === 0
    ? '<tr><td colspan="5" style="text-align:center;padding:28px;color:#888">'
      + 'No accounts yet \u2014 click <strong>Sync from bank</strong> above to discover accounts from TrueLayer.'
      + '</td></tr>'
    : '';

  const hasActualCreds = ACTUAL_URL && ACTUAL_PASS;

  return page('Map Accounts \u2014 ' + name,
    '<p style="margin:0 0 16px"><a href="/">\u2190 Home</a></p>'
    + '<h1>\ud83d\udcc2 Map Accounts \u2014 ' + name + '</h1>'
    + (notice ? '<div class="notice ' + notice.type + '">' + notice.message + '</div>' : '')
    + '<div class="notice info" style="margin-bottom:16px">'
    +   '<strong>How to find your Actual Budget account ID</strong><br>'
    +   (hasActualCreds
        ? 'Click <strong>Browse Actual accounts</strong> below to see all your Actual Budget accounts and their IDs.'
        : 'Run the sync container once with <code>--dry-run</code> to list IDs:<br>'
          + '<code>docker compose run --rm truelayer-sync --dry-run</code><br>'
          + 'Or open Actual Budget \u2192 Settings \u2192 Advanced \u2192 copy the ID next to the account.')
    +   '<br><br><strong>Friendly Name</strong> is shown in sync logs only.<br>'
    +   '<strong>Flip</strong> inverts transaction amounts \u2014 useful if your bank reports credits as negative.'
    + '</div>'
    + '<div style="display:flex;align-items:center;gap:10px;margin-bottom:16px;flex-wrap:wrap">'
    +   '<a class="btn btn-secondary" href="/accounts/' + encodeURIComponent(name) + '/refresh">\u27f3 Sync from bank</a>'
    +   (hasActualCreds ? '<a class="btn btn-ghost" href="/actual-accounts" target="_blank">\ud83d\udd0d Browse Actual accounts</a>' : '')
    +   '<span style="font-size:0.82em;color:#888">Fetches the latest account list from TrueLayer.</span>'
    + '</div>'
    + '<form action="/save-mapping/' + encodeURIComponent(name) + '" method="POST" onsubmit="return validateForm(event)">'
    +   '<div style="overflow-x:auto">'
    +   '<table style="width:100%;border-collapse:collapse">'
    +     '<thead><tr style="background:#f0f0f0;font-size:0.82em">'
    +       '<th style="padding:9px 10px;border:1px solid #ddd;text-align:left">Bank Account</th>'
    +       '<th style="padding:9px 10px;border:1px solid #ddd;text-align:left">TrueLayer ID</th>'
    +       '<th style="padding:9px 10px;border:1px solid #ddd;text-align:left">Actual Budget Account ID</th>'
    +       '<th style="padding:9px 10px;border:1px solid #ddd;text-align:left">Friendly Name</th>'
    +       '<th style="padding:9px 10px;border:1px solid #ddd;text-align:center">Flip</th>'
    +     '</tr></thead>'
    +     '<tbody id="tableBody">' + tableRows + emptyState + '</tbody>'
    +   '</table></div>'
    +   '<div style="background:#fff3cd;border:1px solid #ffc107;padding:10px 14px;border-radius:4px;margin-top:12px;font-size:0.88em;display:none" id="warn">'
    +     '\u26a0\ufe0f No accounts have an Actual Budget ID filled in. At least one is required to save.'
    +   '</div>'
    +   '<input type="hidden" name="allIds" value="' + allIds + '">'
    +   (rows.length > 0 ? '<button class="btn btn-primary" type="submit" style="margin-top:14px">\ud83d\udcbe Save Mappings</button>' : '')
    + '</form>'
    + '<script>function validateForm(e){'
    +   'var ids=document.querySelectorAll(\'input[name^="actualId_"]\');'
    +   'var any=Array.from(ids).some(function(i){return i.value.trim();});'
    +   'if(!any){e.preventDefault();document.getElementById(\'warn\').style.display=\'block\';return false;}'
    +   'return true;}'
    + '<\/script>'
  );
}

// ── Home ──────────────────────────────────────────────────────────────────────
app.get('/', function(req, res) {
  const config = loadConfig();
  const state  = loadState();
  const missingCreds    = !RAW_CLIENT_ID || !CLIENT_SECRET;
  const sandboxPrefixed = SANDBOX && RAW_CLIENT_ID && !RAW_CLIENT_ID.startsWith('sandbox-');

  const connCards = config.connections.length === 0
    ? '<p style="color:#888;font-size:0.9em">No connections yet.</p>'
    : config.connections.map(function(c) {
        const connState  = state.connections[c.name];
        const hasToken   = !!connState;
        const lastSynced = lastSyncedFor(connState);
        const rel        = relativeTime(lastSynced);
        const overdue    = lastSynced && (Date.now() - new Date(lastSynced).getTime()) > 6 * 60 * 60 * 1000;
        return '<div class="card">'
          + '<div style="display:flex;align-items:flex-start;justify-content:space-between;flex-wrap:wrap;gap:8px"><div>'
          + '<strong style="font-size:1.05em">' + c.name + '</strong>'
          + '<span class="tag">' + (c.isCard ? 'Credit Card' : 'Bank Account') + '</span>'
          + '<span class="tag" style="background:' + (hasToken ? '#e6f4ea' : '#fce8e6') + ';color:' + (hasToken ? '#137333' : '#c5221f') + '">'
          + (hasToken ? '\u2705 Authorised' : '\u26a0\ufe0f No token') + '</span>'
          + '<span class="tag">' + c.accounts.length + ' account' + (c.accounts.length !== 1 ? 's' : '') + ' mapped</span>'
          + (rel
              ? '<div class="last-synced' + (overdue ? ' overdue' : '') + '">Last synced: ' + rel + (overdue ? ' \u2014 may be overdue' : '') + '</div>'
              : '<div class="last-synced">Not yet synced</div>')
          + '</div></div>'
          + '<div style="margin-top:12px;display:flex;flex-wrap:wrap;gap:8px">'
          + '<a class="btn btn-secondary" href="/accounts/' + encodeURIComponent(c.name) + '">View / Map Accounts</a>'
          + (hasToken
              ? '<a class="btn btn-green" href="/balances/' + encodeURIComponent(c.name) + '">\ud83d\udcb0 Balances &amp; Transactions</a>'
              : '<a class="btn btn-primary" href="/reauth/' + encodeURIComponent(c.name) + '">\ud83d\udd12 Re-authorise</a>')
          + '<button class="btn btn-danger" onclick="confirmDelete(\'' + c.name.replace(/'/g, "\\'") + '\')">Remove</button>'
          + '</div></div>';
      }).join('');

  res.send(page('Home',
    '<h1>\ud83c\udfe6 TrueLayer \u2192 Actual Budget'
    + '<span class="mode-badge" style="background:' + (SANDBOX ? '#f9ab00' : '#1a73e8') + ';color:#fff">' + (SANDBOX ? 'SANDBOX' : 'LIVE') + '</span>'
    + '</h1>'
    + '<div class="security-banner">'
    +   '\u26a0\ufe0f <strong>Security reminder:</strong> This setup UI exposes your TrueLayer credentials. '
    +   'Run it on demand only \u2014 tear it down when you\'re done: '
    +   '<code>docker compose --profile setup down truelayer-setup</code>'
    + '</div>'
    + '<div class="notice ' + (missingCreds ? 'error' : SANDBOX ? 'info' : 'success') + '" style="margin-bottom:20px">'
    +   '<table class="env-table">'
    +     '<tr><td>Mode</td><td><strong>' + (SANDBOX ? '\u26a0\ufe0f Sandbox \u2014 mock data only' : '\u2705 Live') + '</strong></td></tr>'
    +     '<tr><td>Client ID</td><td><code>' + (CLIENT_ID || '(not set)') + '</code>'
    +       (sandboxPrefixed ? '<span style="color:#888;font-size:0.85em"> (sandbox- prefix added automatically)</span>' : '')
    +     '</td></tr>'
    +     '<tr><td>Client Secret</td><td><code>' + maskSecret(CLIENT_SECRET) + '</code></td></tr>'
    +     '<tr><td>Redirect URI</td><td><code>' + REDIRECT_URI + '</code></td></tr>'
    +     '<tr><td>Auth endpoint</td><td><code>' + AUTH_URL + '</code></td></tr>'
    +     '<tr><td>API endpoint</td><td><code>' + API_URL + '</code></td></tr>'
    +   '</table>'
    +   (missingCreds ? '<br>\u26a0\ufe0f <strong>Missing credentials \u2014 check your .env file.</strong>' : '')
    + '</div>'
    + '<div class="card"><h2>Add Bank Connection</h2>'
    +   '<p style="font-size:0.9em;color:#555;margin:0 0 12px">You\'ll be redirected to TrueLayer to choose and authorise your bank. '
    +   'The connection name is set automatically from the bank\'s display name.</p>'
    +   '<form action="/start-auth" method="POST" style="display:flex;gap:10px;align-items:center;flex-wrap:wrap">'
    +     '<select name="isCard" style="padding:7px 10px;border:1px solid #ccc;border-radius:5px;font-size:0.9em">'
    +       '<option value="false">Bank Account</option>'
    +       '<option value="true">Credit Card</option>'
    +     '</select>'
    +     '<button class="btn btn-primary" type="submit">Connect a Bank \u2192</button>'
    +   '</form>'
    + '</div>'
    + '<h2 style="margin-top:24px">Connections</h2>'
    + connCards
    + '<div class="modal-overlay" id="deleteModal">'
    +   '<div class="modal"><h3>Remove connection?</h3>'
    +     '<p>This will delete <strong id="deleteName"></strong> and its refresh token. Sync will stop for this bank until you re-add it.</p>'
    +     '<div class="modal-actions">'
    +       '<button class="btn btn-ghost" onclick="closeModal()">Cancel</button>'
    +       '<a class="btn btn-danger" id="deleteLink" href="#">Remove</a>'
    +     '</div>'
    +   '</div>'
    + '</div>'
    + '<script>'
    +   'function confirmDelete(name){'
    +     'document.getElementById("deleteName").textContent=name;'
    +     'document.getElementById("deleteLink").href="/delete/"+encodeURIComponent(name);'
    +     'document.getElementById("deleteModal").classList.add("open");}'
    +   'function closeModal(){document.getElementById("deleteModal").classList.remove("open");}'
    +   'document.getElementById("deleteModal").addEventListener("click",function(e){'
    +     'if(e.target===document.getElementById("deleteModal"))closeModal();});'
    + '<\/script>'
  ));
});

// ── Balances & Transactions ───────────────────────────────────────────────────
app.get('/balances/:name', async function(req, res) {
  const name = decodeURIComponent(req.params.name);
  const config = loadConfig();
  const conn   = config.connections.find(function(c) { return c.name === name; });
  if (!conn) return res.status(404).send('Connection not found. <a href="/">Back</a>');

  const state     = loadState();
  const connState = state.connections[name];
  if (!connState) {
    return res.send(page('Balances \u2014 ' + name,
      '<p><a href="/">\u2190 Home</a></p>'
      + '<div class="notice error">\u26a0\ufe0f No token for <strong>' + name + '</strong> \u2014 '
      + '<a href="/reauth/' + encodeURIComponent(name) + '">re-authorise first</a>.</div>'));
  }

  const apiUrl = '/api/balances/' + encodeURIComponent(name);

  res.send(page('Balances & Transactions \u2014 ' + name,
    '<p style="margin:0 0 16px"><a href="/">\u2190 Home</a></p>'
    + '<h1>\ud83d\udcb0 Balances &amp; Transactions \u2014 ' + name + '</h1>'
    + '<p style="font-size:0.85em;color:#666;margin-bottom:18px">Live data from TrueLayer. Showing last 50 transactions per account.</p>'
    + '<div style="margin-bottom:16px;display:flex;gap:10px;align-items:center;flex-wrap:wrap">'
    +   '<button class="btn btn-green" id="refreshBtn" onclick="loadData()">\u27f3 Refresh data</button>'
    +   '<span id="fetchStatus" style="font-size:0.85em;color:#666"></span>'
    + '</div>'
    + '<div id="content">'
    +   '<div style="padding:40px;text-align:center;color:#666">'
    +     '<span class="spinner"></span> Fetching balances and transactions from TrueLayer\u2026'
    +   '</div>'
    + '</div>'
    + '<script>window.__apiUrl = "' + apiUrl + '";<\/script>'
    + BALANCES_SCRIPT
  ));
});

// ── API: fetch balances + transactions ────────────────────────────────────────
app.get('/api/balances/:name', async function(req, res) {
  const name = decodeURIComponent(req.params.name);
  const config = loadConfig();
  const conn   = config.connections.find(function(c) { return c.name === name; });
  if (!conn) return res.status(404).json({ error: 'Connection not found' });

  const state     = loadState();
  const connState = state.connections[name];
  if (!connState) return res.status(401).json({ error: 'No token \u2014 re-authorise first' });

  let accessToken;
  try {
    accessToken = await getAccessToken(name, connState);
  } catch (e) {
    return res.status(401).json({ error: 'Token refresh failed: ' + e.message });
  }

  const endpoint = conn.isCard ? 'cards' : 'accounts';

  let liveAccounts = [];
  try {
    const r = await fetch(API_URL + '/data/v1/' + endpoint, {
      headers: { Authorization: 'Bearer ' + accessToken },
    });
    const d = await r.json();
    liveAccounts = d.results || [];
  } catch (_) {}

  const results = [];

  for (const saved of conn.accounts) {
    const live = liveAccounts.find(function(a) { return a.account_id === saved.trueLayerId; });
    const entry = {
      trueLayerId:  saved.trueLayerId,
      friendlyName: saved.friendlyName,
      displayName:  live ? (live.display_name || live.account_type || saved.trueLayerId) : saved.trueLayerId,
      balance:      null,
      balanceError: null,
      transactions: [],
      txnError:     null,
    };

    try {
      const balRes  = await fetch(API_URL + '/data/v1/' + endpoint + '/' + saved.trueLayerId + '/balance', {
        headers: { Authorization: 'Bearer ' + accessToken },
      });
      const balData = await balRes.json();
      entry.balance = (balData.results || [])[0] || null;
      if (!entry.balance && balData.error) entry.balanceError = balData.error;
    } catch (e) {
      entry.balanceError = e.message;
    }

    try {
      const txnBase = conn.isCard
        ? API_URL + '/data/v1/cards/' + saved.trueLayerId + '/transactions'
        : API_URL + '/data/v1/accounts/' + saved.trueLayerId + '/transactions';
      const from = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
      const to   = new Date().toISOString().slice(0, 10);
      const txnRes  = await fetch(txnBase + '?from=' + from + '&to=' + to, {
        headers: { Authorization: 'Bearer ' + accessToken },
      });
      const txnData = await txnRes.json();
      const all = txnData.results || [];
      all.sort(function(a, b) { return (b.timestamp || '').localeCompare(a.timestamp || ''); });
      entry.transactions = all.slice(0, 50);
      if (entry.transactions.length === 0 && txnData.error) entry.txnError = txnData.error;
    } catch (e) {
      entry.txnError = e.message;
    }

    results.push(entry);
  }

  res.json({ accounts: results });
});

// ── Status JSON ───────────────────────────────────────────────────────────────
app.get('/status', function(req, res) {
  const config = loadConfig();
  const state  = loadState();
  res.json({
    mode: SANDBOX ? 'sandbox' : 'live',
    connections: config.connections.map(function(c) {
      const cs = state.connections[c.name];
      return {
        name: c.name,
        isCard: !!c.isCard,
        accountsMapped: c.accounts.length,
        hasToken: !!cs,
        lastSyncDate: lastSyncedFor(cs),
      };
    }),
  });
});

// ── Actual Budget account browser ─────────────────────────────────────────────
app.get('/actual-accounts', async function(req, res) {
  if (!ACTUAL_URL || !ACTUAL_PASS) {
    return res.status(400).send(page('Actual Accounts',
      '<div class="notice error">ACTUAL_SERVER_URL or ACTUAL_SERVER_PASSWORD not set in environment.</div>'
      + '<p><a href="/">\u2190 Home</a></p>'));
  }

  try {
    const authRes  = await fetch(ACTUAL_URL + '/account/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ loginMethod: 'password', password: ACTUAL_PASS }),
    });
    const authData = await authRes.json();
    const token    = authData.data && authData.data.token;
    if (!token) throw new Error('Login failed: ' + JSON.stringify(authData));

    const budgetsRes  = await fetch(ACTUAL_URL + '/sync/list', {
      headers: { 'x-actual-token': token },
    });
    const budgetsData = await budgetsRes.json();
    const budgets     = budgetsData.data || [];

    if (budgets.length === 0) {
      return res.send(page('Actual Accounts',
        '<p><a href="/">\u2190 Home</a></p><div class="notice info">No budgets found in your Actual instance.</div>'));
    }

    const sections = [];
    for (const budget of budgets) {
      try {
        const dlRes  = await fetch(ACTUAL_URL + '/sync/download-user-file', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-actual-token': token },
          body: JSON.stringify({ fileId: budget.fileId }),
        });
        const dlData   = await dlRes.json();
        const accounts = (dlData.data && dlData.data.accounts) || dlData.accounts || [];
        const rows = accounts.map(function(a) {
          return '<tr><td>' + (a.name || '(unnamed)') + '</td>'
            + '<td><code style="user-select:all">' + a.id + '</code></td>'
            + '<td>' + (a.closed
                ? '<span class="tag" style="background:#fce8e6;color:#c5221f">Closed</span>'
                : '<span class="tag" style="background:#e6f4ea;color:#137333">Open</span>')
            + '</td></tr>';
        }).join('');
        sections.push(
          '<div class="card"><h2>' + (budget.name || budget.fileId) + '</h2>'
          + (accounts.length === 0
              ? '<p style="color:#888;font-size:0.9em">No accounts found.</p>'
              : '<table style="width:100%;border-collapse:collapse;font-size:0.88em">'
                + '<tr style="background:#f0f0f0">'
                + '<th style="padding:8px 10px;border:1px solid #ddd;text-align:left">Account Name</th>'
                + '<th style="padding:8px 10px;border:1px solid #ddd;text-align:left">Account ID (paste into mapping)</th>'
                + '<th style="padding:8px 10px;border:1px solid #ddd;text-align:left">Status</th>'
                + '</tr>' + rows + '</table>')
          + '</div>');
      } catch (err) {
        sections.push('<div class="notice error">Could not load accounts for <strong>'
          + (budget.name || budget.fileId) + '</strong>: ' + err.message + '</div>');
      }
    }

    res.send(page('Actual Accounts',
      '<p><a href="/">\u2190 Home</a></p>'
      + '<h1>\ud83d\udd0d Actual Budget Accounts</h1>'
      + '<p style="font-size:0.9em;color:#555;margin-bottom:20px">Click an Account ID to select it, then copy and paste it into the mapping form.</p>'
      + sections.join('')));
  } catch (err) {
    console.error('Actual accounts error:', err);
    res.send(page('Actual Accounts',
      '<p><a href="/">\u2190 Home</a></p>'
      + '<div class="notice error">\u26a0\ufe0f Could not connect to Actual Budget: ' + err.message + '<br>'
      + 'Make sure ACTUAL_SERVER_URL and ACTUAL_SERVER_PASSWORD are correct in your .env.</div>'));
  }
});

// ── Start OAuth ───────────────────────────────────────────────────────────────
app.post('/start-auth', function(req, res) {
  const isCard = req.body.isCard;
  if (!CLIENT_ID) return res.status(500).send('TRUELAYER_CLIENT_ID not set. <a href="/">Back</a>');

  const scope = isCard === 'true'
    ? 'cards balance transactions offline_access'
    : 'accounts balance transactions offline_access';

  const url = AUTH_URL + '/?' + new URLSearchParams({
    response_type: 'code',
    client_id: CLIENT_ID,
    scope: scope,
    redirect_uri: REDIRECT_URI,
    providers: PROVIDERS,
    response_mode: 'query',
    state: JSON.stringify({ isCard: isCard === 'true' }),
  });

  res.redirect(url);
});

// ── Re-authorise ──────────────────────────────────────────────────────────────
app.get('/reauth/:name', function(req, res) {
  const name = decodeURIComponent(req.params.name);
  if (!CLIENT_ID) return res.status(500).send('TRUELAYER_CLIENT_ID not set. <a href="/">Back</a>');

  const config = loadConfig();
  const conn = config.connections.find(function(c) { return c.name === name; });
  if (!conn) return res.status(404).send('Connection not found. <a href="/">Back</a>');

  const scope = conn.isCard
    ? 'cards balance transactions offline_access'
    : 'accounts balance transactions offline_access';

  const url = AUTH_URL + '/?' + new URLSearchParams({
    response_type: 'code',
    client_id: CLIENT_ID,
    scope: scope,
    redirect_uri: REDIRECT_URI,
    providers: PROVIDERS,
    response_mode: 'query',
    state: JSON.stringify({ isCard: conn.isCard, reauth: name }),
  });

  res.redirect(url);
});

// ── OAuth Callback ────────────────────────────────────────────────────────────
app.get('/callback', async function(req, res) {
  const code       = req.query.code;
  const stateParam = req.query.state;
  if (!code) return res.status(400).send('Missing authorisation code. <a href="/">Try again</a>');

  let isCard = false;
  let reauthName = null;
  try {
    const parsed = JSON.parse(stateParam || '{}');
    isCard     = parsed.isCard || false;
    reauthName = parsed.reauth || null;
  } catch (_) {}

  try {
    const tokenRes = await fetch(AUTH_URL + '/connect/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        client_id: CLIENT_ID,
        client_secret: CLIENT_SECRET,
        redirect_uri: REDIRECT_URI,
        code: code,
      }),
    });
    const tokenData = await tokenRes.json();
    if (!tokenData.refresh_token) throw new Error('No refresh token: ' + JSON.stringify(tokenData));

    if (reauthName) {
      const state    = loadState();
      const existing = state.connections[reauthName] || { accounts: {} };
      state.connections[reauthName] = Object.assign({}, existing, { refreshToken: tokenData.refresh_token });
      saveState(state);
      return res.send(page('Re-authorised',
        '<h1>\u2705 ' + reauthName + ' re-authorised!</h1>'
        + '<p>Fresh token saved. The sync will resume on its next scheduled run.</p>'
        + '<p><a href="/">\u2190 Back to home</a></p>'));
    }

    const endpoint    = isCard ? 'cards' : 'accounts';
    const accountsRes = await fetch(API_URL + '/data/v1/' + endpoint, {
      headers: { Authorization: 'Bearer ' + tokenData.access_token },
    });
    const accountsData = await accountsRes.json();
    const firstAccount = (accountsData.results || [])[0];
    const bankName  = firstAccount
      ? (firstAccount.provider ? firstAccount.provider.display_name : firstAccount.display_name)
      : 'Bank-' + Date.now();
    const baseName  = bankName.replace(/[^a-zA-Z0-9 _-]/g, '').trim();

    const config   = loadConfig();
    const connName = uniqueConnName(baseName, config.connections);

    const state = loadState();
    state.connections[connName] = { refreshToken: tokenData.refresh_token, accounts: {} };
    saveState(state);

    if (!config.connections.find(function(c) { return c.name === connName; })) {
      config.connections.push({ name: connName, isCard: isCard, accounts: [] });
      saveConfig(config);
    }

    res.send(page('Connected',
      '<h1>\u2705 ' + connName + ' connected!</h1>'
      + (connName !== baseName
          ? '<p>\u2139\ufe0f You already had a connection called <strong>' + baseName + '</strong>, so this one was saved as <strong>' + connName + '</strong>.</p>'
          : '')
      + '<p>Token saved. Now <a href="/accounts/' + encodeURIComponent(connName) + '/refresh">discover and map your accounts \u2192</a></p>'
      + '<p><a href="/">\u2190 Back to home</a></p>'));
  } catch (err) {
    console.error('Callback error:', err);
    res.status(500).send(page('Error', '<h1>Error</h1><p>' + err.message + '</p><a href="/">\u2190 Back</a>'));
  }
});

// ── Delete ────────────────────────────────────────────────────────────────────
app.get('/delete/:name', function(req, res) {
  const name = decodeURIComponent(req.params.name);
  const config = loadConfig();
  config.connections = config.connections.filter(function(c) { return c.name !== name; });
  saveConfig(config);
  const state = loadState();
  delete state.connections[name];
  saveState(state);
  res.redirect('/');
});

// ── Account Mapping ───────────────────────────────────────────────────────────
app.get('/accounts/:name', function(req, res) {
  const name = decodeURIComponent(req.params.name);
  const config = loadConfig();
  const conn = config.connections.find(function(c) { return c.name === name; });
  if (!conn) return res.status(404).send('Connection not found. <a href="/">Back</a>');

  const rows   = buildRows(conn.accounts, null);
  const notice = conn.accounts.length === 0
    ? { type: 'info', message: '\ud83d\udd17 No accounts mapped yet \u2014 click <strong>Sync from bank</strong> to fetch the account list from TrueLayer.' }
    : null;

  res.send(renderMappingPage(name, conn, rows, notice));
});

app.get('/accounts/:name/refresh', async function(req, res) {
  const name = decodeURIComponent(req.params.name);
  const config = loadConfig();
  const conn = config.connections.find(function(c) { return c.name === name; });
  if (!conn) return res.status(404).send('Connection not found. <a href="/">Back</a>');

  const state     = loadState();
  const connState = state.connections[name];
  if (!connState) {
    return res.send(renderMappingPage(name, conn, buildRows(conn.accounts, null), {
      type: 'error',
      message: '\u26a0\ufe0f No token for this connection \u2014 <a href="/reauth/' + encodeURIComponent(name) + '">re-authorise</a> first.',
    }));
  }

  try {
    const accessToken  = await getAccessToken(name, connState);
    const endpoint     = conn.isCard ? 'cards' : 'accounts';
    const apiRes       = await fetch(API_URL + '/data/v1/' + endpoint, {
      headers: { Authorization: 'Bearer ' + accessToken },
    });
    const apiData      = await apiRes.json();
    const liveAccounts = apiData.results || [];

    const rows     = buildRows(conn.accounts, liveAccounts);
    const newCount = liveAccounts.filter(function(a) {
      return !conn.accounts.find(function(s) { return s.trueLayerId === a.account_id; });
    }).length;
    const notice = {
      type: 'success',
      message: '\u2705 Fetched ' + liveAccounts.length + ' account' + (liveAccounts.length !== 1 ? 's' : '') + ' from TrueLayer.'
        + (newCount > 0 ? ' ' + newCount + ' new account' + (newCount !== 1 ? 's' : '') + ' discovered.' : ' All accounts already mapped.'),
    };

    res.send(renderMappingPage(name, conn, rows, notice));
  } catch (err) {
    console.error('Refresh error:', err);
    res.send(renderMappingPage(name, conn, buildRows(conn.accounts, null), {
      type: 'error',
      message: '\u26a0\ufe0f Could not fetch accounts from TrueLayer: ' + err.message + '. Your saved mappings are shown below.',
    }));
  }
});

// ── Save Mapping ──────────────────────────────────────────────────────────────
app.post('/save-mapping/:name', function(req, res) {
  const name = decodeURIComponent(req.params.name);
  const config = loadConfig();
  const conn = config.connections.find(function(c) { return c.name === name; });
  if (!conn) return res.status(404).send('Connection not found');

  const ids    = (req.body.allIds || '').split(',').filter(Boolean);
  const mapped = ids
    .map(function(id) {
      const actualId     = (req.body['actualId_' + id]     || '').trim();
      const friendlyName = (req.body['friendlyName_' + id] || '').trim() || actualId;
      const flip         = req.body['flip_' + id] === 'on';
      return Object.assign({ trueLayerId: id, actualId: actualId, friendlyName: friendlyName }, flip ? { flip: true } : {});
    })
    .filter(function(a) { return a.actualId; });

  if (mapped.length === 0) {
    return res.status(400).send(page('Nothing saved',
      '<h1>\u26a0\ufe0f Nothing saved</h1>'
      + '<p>No accounts had an Actual Budget ID filled in. The sync container requires at least one.</p>'
      + '<p><a href="/accounts/' + encodeURIComponent(name) + '">\u2190 Go back and fill in the IDs</a></p>'));
  }

  conn.accounts = mapped;
  saveConfig(config);

  res.send(page('Mappings saved',
    '<h1>\u2705 Mappings saved!</h1>'
    + '<p>Saved ' + conn.accounts.length + ' account mapping(s) for <strong>' + name + '</strong>.</p>'
    + '<p><a href="/accounts/' + encodeURIComponent(name) + '">\u2190 Back to account list</a> &nbsp;|&nbsp; <a href="/">Home</a></p>'
    + '<hr style="margin:20px 0">'
    + '<p><strong>Next steps:</strong></p>'
    + '<p>Start your scheduled sync:</p>'
    + '<pre>docker compose up -d truelayer-sync</pre>'
    + '<p>Then tear down this setup UI:</p>'
    + '<pre>docker compose --profile setup down truelayer-setup</pre>'));
});

app.listen(PORT, function() {
  console.log('Setup UI running on http://0.0.0.0:' + PORT);
  console.log('Mode:          ' + (SANDBOX ? 'SANDBOX' : 'LIVE'));
  console.log('Client ID:     ' + (CLIENT_ID || '(not set)'));
  console.log('Client Secret: ' + maskSecret(CLIENT_SECRET));
  console.log('Redirect URI:  ' + REDIRECT_URI);
});
