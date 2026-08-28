# GeoWeedo YERB reward operations

GeoWeedo separates reward calculation, reward approval, and wallet spending.

## Components

- Player wallet ownership is verified with Yerbas `verifymessage`.
- Reviewed rewards are stored in `data/runtime/rewards.json`.
- `/admin/rewards` manages the auditable reward queue.
- `scripts/yerb-payout-worker.mjs` is the only supplied component that calls `sendtoaddress`.
- The payout worker is dry-run by default.

## Required environment

```env
NEXT_PUBLIC_YERB_DAILY_CAP=25
YERB_RPC_URL=http://127.0.0.1:YOUR_RPC_PORT
YERB_RPC_USER=YOUR_RPC_USER
YERB_RPC_PASSWORD=YOUR_RPC_PASSWORD
YERB_PAYOUTS_ENABLED=false
```

Keep `YERB_PAYOUTS_ENABLED=false` until the reward wallet and dry-run output are verified.

## Dry run

```bash
npm run rewards:dry-run
```

The command prints what it would pay but does not send YERB.

## Execute approved payouts

After reviewing the ledger and setting `YERB_PAYOUTS_ENABLED=true`:

```bash
npm run rewards:pay
```

The worker checks that each player has a verified Yerbas address, applies the daily YERB cap, sends one pending ledger entry at a time, and records the resulting txid. Failed sends are recorded as failed entries rather than silently retried.

## Operational recommendation

Run the payout worker manually at first. Do not schedule it until several dry runs and small-value live payouts have been reviewed. The GeoWeedo web service should not expose a public endpoint that can call `sendtoaddress`.

## Not yet automatic

Gameplay does not automatically create payout entries yet. Current gameplay scoring is still computed in the browser, so it must not directly authorize money movement. The next layer is server-authoritative game sessions and anti-cheat validation; once that exists, a completed validated game can create a pending reward entry automatically.
