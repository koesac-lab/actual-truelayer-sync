const express = require('express');
const fs = require('fs');
const path = require('path');

const app = express();
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

const DATA_DIR = process.env.DATA_DIR || '/app/data';
const PORT = process.env.PORT || 3099;
const CONFIG_PATH = path.join(DATA_DIR, 'config.json');
const STATE_PATH = path.join(DATA_DIR, 'state.json');

const REDIRECT_URI = process.env.REDIRECT_URI;
if (!REDIRECT_URI) {
  console.error('ERROR: REDIRECT_URI env var is not set.');
  console.error('e.g. REDIRECT_URI=https://truelayer.example.com/callback');
  process.exit(1);
}

const RAW_CLIENT_ID = process.env.TRUELAYER_CLIENT_ID || '';
const CLIENT_SECRET  = process.env.TRUELAYER_CLIENT_SECRET || '';
const SANDBOX = (process.env.TRUELAYER_ENV || '').toLowerCase() === 'sandbox';

// In sandbox mode TrueLayer requires the client_id prefixed with "sandbox-"
const CLIENT_ID = SANDBOX && RAW_CLIENT_ID && !RAW_CLIENT_ID.startsWith('sandbox-')
  ? `sandbox-${RAW_CLIENT_ID}`
  : RAW_CLIENT_ID;

const AUTH_URL  = SANDBOX ? 'https://auth.truelayer-sandbox.com' : 'https://auth.truelayer.com';
const API_URL   = SANDBOX ? 'https://api.truelayer-sandbox.com'  : 'https://api.truelayer.com';
const PROVIDERS = SANDBOX ? 'uk-cs-mock' : 'uk-ob-all uk-oauth-all';

console.log(`Mode:         ${SANDBOX ? 'SANDBOX' : 'LIVE'}`);
console.log(`Client ID:    ${CLIENT_ID || '(not set)'}`);
console.log(`Auth:         ${AUTH_URL}`);
console.log(`Redirect URI: ${REDIRECT_URI}`);

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

// ── Home ──────────────────────────────────────────────────────────────────────
app.get('/', (req, res) => {
  const config = loadConfig();
  const state  = loadState();
  const missingCreds = !RAW_CLIENT_ID || !CLIENT_SECRET;
  const sandboxPrefixed = SANDBOX && RAW_CLIENT_ID && !RAW_CLIENT_ID.startsWith('sandbox-');

  res.send(`<!DOCTYPE html>
<html>
<head>
  <title>TrueLayer Setup</title>
  <style>
    body { font-family: system-ui; max-width: 700px; margin: 40px auto; padding: 0 20px; background: #f9f9f9; }
    h1 { color: #1a1a2e; }
    label { display: block; margin: 10px 0 4px; font-weight: 600; }
    select { width: 100%; padding: 8px; box-sizing: border-box; margin-bottom: 12px; border: 1px solid #ccc; border-radius: 4px; }
    button { padding: 10px 20px; background: #0066cc; color: white; border: none; border-radius: 4px; cursor: pointer; }
    button:hover { background: #0052a3; }
    .card { background: white; border: 1px solid #ddd; padding: 16px; margin: 12px 0; border-radius: 6px; }
    .tag { display: inline-block; padding: 2px 8px; border-radius: 12px; font-size: 0.8em; background: #e8f0fe; color: #1a73e8; margin-left: 6px; }
    a.btn { display: inline-block; padding: 6px 14px; background: #444; color: white; text-decoration: none; border-radius: 4px; font-size: 0.9em; margin-top: 8px; margin-right: 6px; }
    .info { border-left: 4px solid #1a73e8; padding: 12px 16px; margin-bottom: 16px; font-size: 0.9em; border-radius: 0 4px 4px 0; line-height: 1.8; }
    .info.live    { background: #e8f0fe; border-left-color: #1a73e8; }
    .info.sandbox { background: #fef7e0; border-left-color: #f9ab00; }
    .info.error   { background: #fce8e6; border-left-color: #c5221f; }
    .mode-badge { display: inline-block; padding: 3px 10px; border-radius: 12px; font-weight: 700; font-size: 0.85em; margin-left: 8px;
      background: ${SANDBOX ? '#f9ab00' : '#1a73e8'}; color: white; vertical-align: middle; }
    code { background: #f0f0f0; padding: 2px 6px; border-radius: 3px; font-size: 0.9em; font-family: monospace; }
    .derived { color: #888; font-size: 0.85em; margin-left: 6px; }
    table.env { width: 100%; border-collapse: collapse; margin-top: 4px; }
    table.env td { padding: 4px 8px; }
    table.env td:first-child { font-weight: 600; width: 150px; color: #555; }
  </style>
</head>
<body>
  <h1>&#127974; TrueLayer &rarr; Actual Budget <span class="mode-badge">${SANDBOX ? 'SANDBOX' : 'LIVE'}</span></h1>

  <div class="info ${missingCreds ? 'error' : SANDBOX ? 'sandbox' : 'live'}">
    <table class="env">
      <tr><td>Mode</td><td><strong>${SANDBOX ? '&#9888;&#65039; Sandbox &mdash; test data only' : '&#9989; Live'}</strong></td></tr>
      <tr><td>Client ID</td>
          <td><code>${CLIENT_ID || '(not set)'}</code>
          ${sandboxPrefixed ? '<span class="derived">(sandbox- prefix added automatically)</span>' : ''}
          </td>
      </tr>
      <tr><td>Client Secret</td><td><code>${maskSecret(CLIENT_SECRET)}</code></td></tr>
      <tr><td>Redirect URI</td><td><code>${REDIRECT_URI}</code></td></tr>
      <tr><td>Auth endpoint</td><td><code>${AUTH_URL}</code></td></tr>
      <tr><td>API endpoint</td><td><code>${API_URL}</code></td></tr>
    </table>
    ${missingCreds ? '<br>&#9888;&#65039; <strong>Missing credentials &mdash; check your .env file.</strong>' : ''}
    ${SANDBOX ? '<br>Remove <code>TRUELAYER_ENV=sandbox</code> from your compose env to switch to live mode.' : ''}
  </div>

  <div class="card">
    <h2>Add Bank Connection</h2>
    <p>You\'ll be redirected to TrueLayer to choose and authorise your bank. The connection name is set automatically.</p>
    <form action="/start-auth" method="POST">
      <label>Account Type</label>
      <select name="isCard">
        <option value="false">Bank Account</option>
        <option value="true">Credit Card</option>
      </select>
      <button type="submit">Connect a Bank &rarr;</button>
    </form>
  </div>

  <h2>Existing Connections</h2>
  ${config.connections.length === 0 ? '<p>None yet.</p>' : config.connections.map(c => {
    const hasToken = !!state.connections[c.name];
    return `<div class="card">
      <strong>${c.name}</strong>
      <span class="tag">${c.isCard ? 'Credit Card' : 'Bank Account'}</span>
      <span class="tag" style="background:${hasToken ? '#e6f4ea' : '#fce8e6'};color:${hasToken ? '#137333' : '#c5221f'}">
        ${hasToken ? '&#9989; Authorised' : '&#9888;&#65039; No token'}
      </span>
      <br><br>
      ${hasToken ? `<a class="btn" href="/accounts/${encodeURIComponent(c.name)}">View / Map Accounts</a>` : ''}
      <a class="btn" style="background:#c5221f" href="/delete/${encodeURIComponent(c.name)}">Remove</a>
    </div>`;
  }).join('')}
</body>
</html>`);
});

// ── Start OAuth ───────────────────────────────────────────────────────────────
app.post('/start-auth', (req, res) => {
  const { isCard } = req.body;
  if (!CLIENT_ID) return res.status(500).send('TRUELAYER_CLIENT_ID not set. <a href="/">Back</a>');

  const scope = isCard === 'true'
    ? 'cards balance transactions offline_access'
    : 'accounts balance transactions offline_access';

  const stateParam = JSON.stringify({ isCard: isCard === 'true' });

  const url = `${AUTH_URL}/?${new URLSearchParams({
    response_type: 'code',
    client_id: CLIENT_ID,
    scope,
    redirect_uri: REDIRECT_URI,
    providers: PROVIDERS,
    response_mode: 'query',
    state: stateParam
  })}`;

  res.redirect(url);
});

// ── OAuth Callback ────────────────────────────────────────────────────────────
app.get('/callback', async (req, res) => {
  const { code, state: stateParam } = req.query;
  if (!code) return res.status(400).send('Missing authorisation code. <a href="/">Try again</a>');

  let isCard = false;
  try {
    const parsed = JSON.parse(stateParam || '{}');
    isCard = parsed.isCard || false;
  } catch (_) {}

  try {
    const tokenRes = await fetch(`${AUTH_URL}/connect/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        client_id: CLIENT_ID,
        client_secret: CLIENT_SECRET,
        redirect_uri: REDIRECT_URI,
        code
      })
    });

    const tokenData = await tokenRes.json();
    if (!tokenData.refresh_token) throw new Error('No refresh token: ' + JSON.stringify(tokenData));

    const endpoint = isCard ? 'cards' : 'accounts';
    const accountsRes = await fetch(`${API_URL}/data/v1/${endpoint}`, {
      headers: { Authorization: `Bearer ${tokenData.access_token}` }
    });
    const accountsData = await accountsRes.json();
    const firstAccount = (accountsData.results || [])[0];
    const bankName = firstAccount
      ? (firstAccount.provider ? firstAccount.provider.display_name : firstAccount.display_name)
      : 'Bank-' + Date.now();
    const connName = bankName.replace(/[^a-zA-Z0-9 _-]/g, '').trim();

    // Write state matching ConnectionStateSchema: { refreshToken, accounts: {} }
    const state = loadState();
    state.connections[connName] = { refreshToken: tokenData.refresh_token, accounts: {} };
    saveState(state);

    const config = loadConfig();
    if (!config.connections.find(c => c.name === connName)) {
      config.connections.push({ name: connName, isCard, accounts: [] });
      saveConfig(config);
    }

    res.send(`<!DOCTYPE html><html><body style="font-family:system-ui;max-width:600px;margin:40px auto;padding:0 20px">
      <h1>&#9989; ${connName} connected!</h1>
      <p>Token saved. Now <a href="/accounts/${encodeURIComponent(connName)}">map your accounts &rarr;</a></p>
      <p><a href="/">&larr; Back to home</a></p>
    </body></html>`);
  } catch (err) {
    console.error('Callback error:', err);
    res.status(500).send(`<h1>Error</h1><p>${err.message}</p><a href="/">&larr; Back</a>`);
  }
});

// ── Delete connection ─────────────────────────────────────────────────────────
app.get('/delete/:name', (req, res) => {
  const name = decodeURIComponent(req.params.name);
  const config = loadConfig();
  config.connections = config.connections.filter(c => c.name !== name);
  saveConfig(config);
  const state = loadState();
  delete state.connections[name];
  saveState(state);
  res.redirect('/');
});

// ── Account Discovery & Mapping ───────────────────────────────────────────────
app.get('/accounts/:name', async (req, res) => {
  const name = decodeURIComponent(req.params.name);
  const config = loadConfig();
  const conn = config.connections.find(c => c.name === name);
  if (!conn) return res.status(404).send('Connection not found. <a href="/">Back</a>');

  try {
    const state = loadState();
    const connState = state.connections[name];
    if (!connState) throw new Error('No token for this connection — re-authorise from home page');

    const tokenRes = await fetch(`${AUTH_URL}/connect/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'refresh_token',
        client_id: CLIENT_ID,
        client_secret: CLIENT_SECRET,
        refresh_token: connState.refreshToken
      })
    });
    const tokenData = await tokenRes.json();
    if (!tokenData.access_token) throw new Error('Token refresh failed: ' + JSON.stringify(tokenData));

    const endpoint = conn.isCard ? 'cards' : 'accounts';
    const apiRes = await fetch(`${API_URL}/data/v1/${endpoint}`, {
      headers: { Authorization: `Bearer ${tokenData.access_token}` }
    });
    const apiData = await apiRes.json();
    const accounts = apiData.results || [];

    const allIds   = accounts.map(a => a.account_id).join(',');

    const rows = accounts.map(acc => {
      const existing = conn.accounts.find(a => a.trueLayerId === acc.account_id);
      return `<tr>
          <td>${acc.display_name || acc.account_type}</td>
          <td><code style="font-size:0.8em">${acc.account_id}</code></td>
          <td><input name="actualId_${acc.account_id}" value="${existing ? existing.actualId : ''}" placeholder="Paste Actual account ID"></td>
          <td><input name="friendlyName_${acc.account_id}" value="${existing ? existing.friendlyName : (acc.display_name || acc.account_type)}" placeholder="e.g. Main Current Account"></td>
          <td style="text-align:center"><input type="checkbox" name="flip_${acc.account_id}" ${existing && existing.flip ? 'checked' : ''}></td>
        </tr>`;
    }).join('');

    res.send(`<!DOCTYPE html>
<html>
<head>
  <title>Map Accounts - ${name}</title>
  <style>
    body { font-family: system-ui; max-width: 1000px; margin: 40px auto; padding: 0 20px; }
    table { width: 100%; border-collapse: collapse; }
    th, td { padding: 10px; border: 1px solid #ddd; text-align: left; vertical-align: middle; }
    th { background: #f0f0f0; font-size: 0.85em; }
    input[type=text], input:not([type]) { width: 100%; padding: 6px; box-sizing: border-box; border: 1px solid #ccc; border-radius: 3px; }
    button { padding: 10px 20px; background: #0066cc; color: white; border: none; border-radius: 4px; cursor: pointer; margin-top: 16px; }
    a { color: #0066cc; }
    code { background: #f4f4f4; padding: 2px 4px; border-radius: 3px; }
    .hint { font-size: 0.85em; color: #666; margin-bottom: 12px; }
    .warn { background: #fff3cd; border: 1px solid #ffc107; padding: 10px 14px; border-radius: 4px; margin-top: 12px; font-size: 0.9em; display: none; }
  </style>
</head>
<body>
  <h1>&#128194; Map Accounts &mdash; ${name}</h1>
  <p class="hint">
    Find your <strong>Actual Budget account ID</strong> in Actual: Settings &rarr; click an account &rarr; the ID is in the URL or shown under Advanced.<br>
    <strong>Friendly Name</strong> is used in sync logs. <strong>Flip</strong> inverts transaction amounts (useful for credit cards shown as positive).
  </p>
  <form action="/save-mapping/${encodeURIComponent(name)}" method="POST" onsubmit="return validateForm(event)">
    <table>
      <tr>
        <th>Bank Account</th>
        <th>TrueLayer ID</th>
        <th>Actual Budget Account ID</th>
        <th>Friendly Name</th>
        <th>Flip</th>
      </tr>
      ${rows}
    </table>
    <div class="warn" id="warn">&#9888;&#65039; No accounts have an Actual Budget ID filled in. At least one is required to save — otherwise the sync container will crash on startup.</div>
    <input type="hidden" name="allIds" value="${allIds}">
    <button type="submit">&#128190; Save Mappings</button>
  </form>
  <script>
    function validateForm(e) {
      const ids = document.querySelectorAll('input[name^="actualId_"]');
      const any = Array.from(ids).some(i => i.value.trim());
      if (!any) {
        e.preventDefault();
        document.getElementById('warn').style.display = 'block';
        return false;
      }
      return true;
    }
  </script>
  <br><a href="/">&larr; Back</a>
</body>
</html>`);
  } catch (err) {
    res.status(500).send('Error: ' + err.message + '<br><a href="/">&larr; Back</a>');
  }
});

app.post('/save-mapping/:name', (req, res) => {
  const name = decodeURIComponent(req.params.name);
  const config = loadConfig();
  const conn = config.connections.find(c => c.name === name);
  if (!conn) return res.status(404).send('Connection not found');

  const ids = req.body.allIds.split(',').filter(Boolean);

  const mapped = ids
    .map(id => {
      const actualId     = (req.body[`actualId_${id}`] || '').trim();
      const friendlyName = (req.body[`friendlyName_${id}`] || '').trim();
      const flip         = req.body[`flip_${id}`] === 'on';
      return { trueLayerId: id, actualId, friendlyName, ...(flip ? { flip: true } : {}) };
    })
    .filter(a => a.actualId && a.friendlyName);

  if (mapped.length === 0) {
    return res.status(400).send(`<h1>&#9888;&#65039; Nothing saved</h1>
      <p>No accounts had an Actual Budget ID filled in. The sync container requires at least one mapped account.</p>
      <p><a href="/accounts/${encodeURIComponent(name)}">&larr; Go back and fill in the IDs</a></p>`);
  }

  conn.accounts = mapped;
  saveConfig(config);

  res.send(`<!DOCTYPE html><html><body style="font-family:system-ui;max-width:600px;margin:40px auto;padding:0 20px">
    <h1>&#9989; Mappings saved!</h1>
    <p>Saved ${conn.accounts.length} account mapping(s) for <strong>${name}</strong>.</p>
    <p><a href="/accounts/${encodeURIComponent(name)}">&#8592; Back to account list</a> &nbsp;|&nbsp; <a href="/">Home</a></p>
    <hr>
    <p>Start your scheduled sync:</p>
    <pre style="background:#f4f4f4;padding:12px;border-radius:4px">docker compose up -d truelayer-sync</pre>
    <p>Then tear down this setup UI:</p>
    <pre style="background:#f4f4f4;padding:12px;border-radius:4px">docker compose --profile setup down truelayer-setup</pre>
  </body></html>`);
});

app.listen(PORT, () => {
  console.log(`Setup UI running on http://0.0.0.0:${PORT}`);
  console.log(`Mode:         ${SANDBOX ? 'SANDBOX' : 'LIVE'}`);
  console.log(`Client ID:    ${CLIENT_ID || '(not set)'}`);
  console.log(`Client Secret:${maskSecret(CLIENT_SECRET)}`);
  console.log(`Redirect URI: ${REDIRECT_URI}`);
});
