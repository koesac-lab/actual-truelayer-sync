# actual-truelayer-sync

Self-hosted TrueLayer → Actual Budget setup UI.

## Setup

1. Copy `.env.example` to `.env` and fill in your credentials.
2. Run the setup UI:
   ```bash
   docker compose --profile setup up -d --build
   ```
3. Open `http://localhost:3099` (or your configured URL).
4. Connect your bank, map accounts, save.
5. Tear down the setup UI when done:
   ```bash
   docker compose --profile setup down
   ```

## Environment Variables

| Variable | Description |
|---|---|
| `TRUELAYER_CLIENT_ID` | TrueLayer app client ID |
| `TRUELAYER_CLIENT_SECRET` | TrueLayer app client secret |
| `TRUELAYER_ENV` | `live` or `sandbox` |
| `REDIRECT_URI` | Must match your TrueLayer app redirect URI (e.g. `https://truelayer.yourdomain.com/callback`) |
| `ACTUAL_SERVER_URL` | URL of your Actual Budget server |
| `ACTUAL_SERVER_PASSWORD` | Actual Budget server password |

## Data

All state is persisted in `./truelayer-data/` (`config.json` and `state.json`).

## Deploy

Pushing to `main` triggers the self-hosted runner to sync the repo and rebuild the setup image automatically.
