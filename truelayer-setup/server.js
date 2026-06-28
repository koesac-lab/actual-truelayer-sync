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

// If REDIRECT_URI is set explicitly (recommended), use that.
// Otherwise derive from the incoming request (works for direct IP access).
const EXPLICIT_REDIRECT_URI = process.env.REDIRECT_URI || null;

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

function getRedirectUri(req) {
  if (EXPLICIT_REDIRECT_URI) return EXPLICIT_REDIRECT_URI;
  const proto = req.headers['x-forwarded-proto'] || req.protocol;
  const host = req.headers['x-forwarded-host'] || req.get('host');
  return `${proto}://${host}/callback`;
}

async function getAccessToken(name) {
  const state = loadState();
  const conn = state.connections[name];
  if (!conn) throw new Error(`No state found for connection: ${name}`);
  const res = await fetch('https://auth.truelayer.com/connect/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      client_id: process.env.TRUELAYER_CLIENT_ID,
      client_secret: process.env.TRUELAYER_CLIENT_SECRET,
      refresh_token: conn.refreshToken
    })
  });
  const data = await res.json();
  if (!data.access_token) throw new Error('Token refresh failed: ' + JSON.stringify(data));
  return data.access_token;
}

// ── Home ──────────────────────────────────────────────────────────────────────
app.get('/', (req, res) => {
  const config = loadConfig();
  const state = loadState();
  const redirectUri = getRedirectUri(req);
  res.send(`<!DOCTYPE html>
<html>
<head>
  <title>TrueLayer Setup</title>
  <style>
    body { font-family: system-ui; max-width: 700px; margin: 40px auto; padding: 0 20px; background: #f9f9f9; }
    h1 { color: #1a1a2e; }
    label { display: block; margin: 10px 0 4px; font-weight: 600; }
    input, select { width: 100%; padding: 8px; box-sizing: border-box; margin-bottom: 12px; border: 1px solid #ccc; border-radius: 4px; }
    button { padding: 10px 20px; background: #0066cc; color: white; border: none; border-radius: 4px; cursor: pointer; }
    button:hover { background: #0052a3; }
    .card { background: white; border: 1px solid #ddd; padding: 16px; margin: 12px 0; border-radius: 6px; }
    .tag { display: inline-block; padding: 2px 8px; border-radius: 12px; font-size: 0.8em; background: #e8f0fe; color: #1a73e8; margin-left: 6px; }
    a.btn { display: inline-block; padding: 6px 14px; background: #444; color: white; text-decoration: none; border-radius: 4px; font-size: 0.9em; margin-top: 8px; }
    .info { background: #e8f0fe; border-left: 4px solid #1a73e8; padding: 10px 14px; margin-bottom: 16px; font-size: 0.9em; border-radius: 0 4px 4px 0; }
    code { background: #f0f0f0; padding: 2px 6px; border-radius: 3px; font-size: 0.9em; }
  </style>
</head>
<body>
  <h1>&#127974; TrueLayer &rarr; Actual Budget Setup</h1>

  <div class="info">
    Redirect URI registered in TrueLayer Console must be exactly:<br>
    <code>${redirectUri}</code>
  </div>

  <div class="card">
    <h2>Add Bank Connection</h2>
    <p>You'll be sent to TrueLayer to choose and authorise your bank. The connection will be named automatically from your bank after authorisation.</p>
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
  const clientId = process.env.TRUELAYER_CLIENT_ID;
  if (!clientId) return res.status(500).send('TRUELAYER_CLIENT_ID not set');

  const redirectUri = getRedirectUri(req);
  const scope = isCard === 'true'
    ? 'cards balance transactions offline_access'
    : 'accounts balance transactions offline_access';

  // Pass isCard in state so we know the type after callback
  const stateParam = JSON.stringify({ isCard: isCard === 'true' });

  const url = `https://auth.truelayer.com/?${new URLSearchParams({
    response_type: 'code',
    client_id: clientId,
    scope,
    redirect_uri: redirectUri,
    providers: 'uk-ob-all uk-oauth-all',
    response_mode: 'query',
    state: stateParam
  })}`;

  console.log('Redirecting to TrueLayer, redirect_uri:', redirectUri);
  res.redirect(url);
});

// ── OAuth Callback ────────────────────────────────────────────────────────────
app.get('/callback', async (req, res) => {
  const { code, state: stateParam } = req.query;
  if (!code) return res.status(400).send('Missing authorisation code');

  let isCard = false;
  try {
    const parsed = JSON.parse(stateParam || '{}');
    isCard = parsed.isCard || false;
  } catch (_) {}

  try {
    const redirectUri = getRedirectUri(req);
    console.log('Exchanging code, redirect_uri:', redirectUri);

    const tokenRes = await fetch('https://auth.truelayer.com/connect/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        client_id: process.env.TRUELAYER_CLIENT_ID,
        client_secret: process.env.TRUELAYER_CLIENT_SECRET,
        redirect_uri: redirectUri,
        code
      })
    });

    const tokenData = await tokenRes.json();
    if (!tokenData.refresh_token) throw new Error('No refresh token: ' + JSON.stringify(tokenData));

    // Fetch the bank name from TrueLayer metadata
    const endpoint = isCard ? 'cards' : 'accounts';
    const accountsRes = await fetch(`https://api.truelayer.com/data/v1/${endpoint}`, {
      headers: { Authorization: `Bearer ${tokenData.access_token}` }
    });
    const accountsData = await accountsRes.json();
    const firstAccount = (accountsData.results || [])[0];
    const bankName = firstAccount ? (firstAccount.provider ? firstAccount.provider.display_name : firstAccount.display_name) : `Bank-${Date.now()}`;
    const connName = bankName.replace(/[^a-zA-Z0-9 _-]/g, '').trim();

    // Save token
    const state = loadState();
    state.connections[connName] = { refreshToken: tokenData.refresh_token, lastSync: null };
    saveState(state);

    // Save connection in config
    const config = loadConfig();
    if (!config.connections.find(c => c.name === connName)) {
      config.connections.push({ name: connName, isCard, accounts: [] });
      saveConfig(config);
    }

    res.send(`<!DOCTYPE html><html><body style="font-family:system-ui;max-width:600px;margin:40px auto;padding:0 20px">
      <h1>&#9989; ${connName} connected!</h1>
      <p>Token saved. Now <a href="/accounts/${encodeURIComponent(connName)}">view and map accounts &rarr;</a></p>
    </body></html>`);
  } catch (err) {
    console.error('Callback error:', err);
    res.status(500).send(`Error: ${err.message}<br><a href="/">&larr; Back</a>`);
  }
});

// ── Delete connection ─────────────────────────────────────────────────────────────
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
  if (!conn) return res.status(404).send('Connection not found');

  try {
    const token = await getAccessToken(name);
    const endpoint = conn.isCard ? 'cards' : 'accounts';
    const apiRes = await fetch(`https://api.truelayer.com/data/v1/${endpoint}`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    const apiData = await apiRes.json();
    const accounts = apiData.results || [];

    const allIds = accounts.map(a => a.account_id).join(',');
    const allNames = accounts.map(a => encodeURIComponent(a.display_name || a.account_type)).join(',');

    const rows = accounts.map(acc => {
      const existing = conn.accounts.find(a => a.trueLayerId === acc.account_id);
      return `<tr>
          <td>${acc.display_name || acc.account_type}</td>
          <td><code>${acc.account_id}</code></td>
          <td><input name="mapping_${acc.account_id}" value="${existing ? existing.actualId : ''}" placeholder="e.g. abc123..."></td>
        </tr>`;
    }).join('');

    res.send(`<!DOCTYPE html>
<html>
<head>
  <title>Map Accounts - ${name}</title>
  <style>
    body { font-family: system-ui; max-width: 800px; margin: 40px auto; padding: 0 20px; }
    table { width: 100%; border-collapse: collapse; }
    th, td { padding: 10px; border: 1px solid #ddd; text-align: left; }
    th { background: #f0f0f0; }
    input { width: 100%; padding: 6px; box-sizing: border-box; }
    button { padding: 10px 20px; background: #0066cc; color: white; border: none; border-radius: 4px; cursor: pointer; margin-top: 16px; }
    a { color: #0066cc; }
    code { background: #f4f4f4; padding: 2px 6px; border-radius: 3px; font-size: 0.9em; }
  </style>
</head>
<body>
  <h1>&#128194; Map Accounts - ${name}</h1>
  <p>Paste the <strong>Actual Budget account ID</strong> (from Settings &rarr; Accounts in Actual) next to each account. Leave blank to skip.</p>
  <form action="/save-mapping/${encodeURIComponent(name)}" method="POST">
    <table>
      <tr>
        <th>Bank Account Name</th>
        <th>TrueLayer ID</th>
        <th>Actual Budget Account ID</th>
      </tr>
      ${rows}
    </table>
    <input type="hidden" name="allIds" value="${allIds}">
    <input type="hidden" name="allNames" value="${allNames}">
    <button type="submit">&#128190; Save Mappings</button>
  </form>
  <br><a href="/">&larr; Back</a>
</body>
</html>`);
  } catch (err) {
    res.status(500).send('Error fetching accounts: ' + err.message + '<br><a href="/">&larr; Back</a>');
  }
});

app.post('/save-mapping/:name', (req, res) => {
  const name = decodeURIComponent(req.params.name);
  const config = loadConfig();
  const conn = config.connections.find(c => c.name === name);
  if (!conn) return res.status(404).send('Connection not found');

  const ids = req.body.allIds.split(',');
  const names = req.body.allNames.split(',').map(n => decodeURIComponent(n));

  conn.accounts = ids
    .map((id, i) => ({ trueLayerId: id, name: names[i], actualId: req.body[`mapping_${id}`] }))
    .filter(a => a.actualId && a.actualId.trim());

  saveConfig(config);
  res.send(`<!DOCTYPE html><html><body style="font-family:system-ui;max-width:600px;margin:40px auto;padding:0 20px">
    <h1>&#9989; Mappings saved!</h1>
    <p>Saved ${conn.accounts.length} account mapping(s) for <strong>${name}</strong>.</p>
    <p><a href="/">&larr; Back to home</a></p>
    <hr>
    <p>Start your scheduled sync:</p>
    <pre style="background:#f4f4f4;padding:12px;border-radius:4px">docker compose up -d actual-truelayer-sync</pre>
    <p>Then tear down this setup UI:</p>
    <pre style="background:#f4f4f4;padding:12px;border-radius:4px">docker compose --profile setup down truelayer-setup</pre>
  </body></html>`);
});

app.listen(PORT, () => {
  console.log(`Setup UI running on http://0.0.0.0:${PORT}`);
  console.log(`Redirect URI: ${EXPLICIT_REDIRECT_URI || '(derived from request)'}`);
});
