# Migration Guide

## v1 → v2

Config format version 2 separates user configuration from runtime state. The app no longer writes to `config.json`.

### What changed

- `refreshToken` has moved out of `config.json` into `state.json`
- `lastSyncDate` has moved out of `config.json` into `state.json`
- `config.json` now requires a `"version": 2` field
- A new `state.json` file in your `data/` directory is now required on startup
- Connections now required to have unique names (enforced by schema) — this is necessary to key state by connection name

### Steps

**1. Create `state.json`**

Create `data/state.json` using your existing `config.json` values. For each connection, take the `refreshToken`. For
each account, take the `lastSyncDate` (if present).

```json
{
  "connections": {
    "My Bank": {
      "refreshToken": "<your existing refreshToken>",
      "accounts": {
        "<trueLayerId>": { "lastSyncDate": "<your existing lastSyncDate>" }
      }
    }
  }
}
```

Accounts with no `lastSyncDate` can be omitted or set to `"accounts": {}` — the app will fetch all available history on
the next sync.

See `state.example.json` for the full expected format.

**2. Update `config.json`**

- Add `"version": 2` at the top level
- Remove `refreshToken` from every connection
- Remove `lastSyncDate` from every account

Before:
```json
{
  "includeCategoryInNotes": false,
  "connections": [
    {
      "name": "My Bank",
      "refreshToken": "ey...",
      "accounts": [
        {
          "trueLayerId": "acc-123",
          "actualId": "abc-456",
          "friendlyName": "Current Account",
          "lastSyncDate": "2026-04-27"
        }
      ]
    }
  ]
}
```

After:
```json
{
  "version": 2,
  "includeCategoryInNotes": false,
  "connections": [
    {
      "name": "My Bank",
      "accounts": [
        {
          "trueLayerId": "acc-123",
          "actualId": "abc-456",
          "friendlyName": "Current Account"
        }
      ]
    }
  ]
}
```

**3. Verify**

Start the app. You should see `State saved.` in the logs after the first successful sync. If anything is wrong, the app
should log a clear error pointing to the relevant file.
