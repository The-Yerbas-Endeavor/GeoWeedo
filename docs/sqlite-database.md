# GeoWeedo SQLite application database

GeoWeedo uses one server-side SQLite database at:

`data/runtime/geoweedo.sqlite`

The database is created automatically by `lib/sqlite.ts` when the application first opens it. WAL mode, foreign keys, a busy timeout, and schema migrations are enabled at initialization.

## Core domains

### Identity and administration

- `admin_users`
- `admin_sessions`
- `users`
- `user_sessions`
- `login_challenges`
- `password_reset_tokens`
- `app_settings`
- `audit_log`

Session tokens must be stored as hashes, never plaintext. Passwords must be stored using a modern password hash. Wallet-signature login challenges are short-lived and one-time use.

### Yerbas balances and payments

- `wallets`
- `wallet_addresses`
- `wallet_ledger`
- `deposits`
- `withdrawals`
- `reward_claims`
- `rpc_jobs`

All YERB amounts are stored as signed integer atomic units in ledger/payment tables. Do not calculate balances with floating-point values. A wallet balance is the sum of its posted ledger entries.

GeoWeedo must never store a Yerbas wallet seed or spend private key in this database. Blockchain signing and transaction broadcast remain behind the configured Yerbas Core RPC service. The web process queues work in `rpc_jobs`; a restricted worker performs RPC operations.

Recommended withdrawal flow:

1. Validate authenticated user and destination address.
2. Calculate spendable balance from posted ledger entries.
3. Create a withdrawal request and reserve the amount with a ledger hold.
4. Queue an RPC job.
5. Restricted worker sends the transaction.
6. Record the txid and convert the hold into a posted debit.
7. On failure, release the hold and record the reason.

Recommended deposit flow:

1. Assign a deposit address to the user's wallet.
2. Wallet scanner records unique `txid + vout` entries in `deposits`.
3. Wait for the configured confirmation threshold.
4. Add exactly one positive posted ledger entry.
5. Continue tracking confirmation/reorg state without duplicating the credit.

### Dispensary and map data

- `dispensary_candidates`
- `dispensaries`
- `map_locations`
- `imagery_assets`

Official regulator data enters `dispensary_candidates`. A candidate becomes a playable `dispensary` only after its coordinates and imagery are reviewed. `imagery_assets` can contain KartaView references or GeoWeedo-hosted imagery, including 360 metadata and attribution.

### Gameplay

- `games`
- `game_rounds`
- `daily_challenges`
- `daily_challenge_rounds`
- `leaderboard_entries`
- `favorites`

The intended production path is server-authoritative games: the server selects rounds, stores an opaque round token, calculates distance and score after each submitted guess, and creates any eligible reward claim only after the game is completed and validated.

### Community and commercial features

- `sponsorships`
- `notifications`

Sponsorship affects location selection priority only. It must not change geographic score or reward rate.

## Database health endpoint

`GET /api/admin/database`

Requires the existing `x-geoweedo-admin` header. It initializes the SQLite database if necessary and returns the current migration plus row counts for the major tables.

Example from the GeoWeedo server:

```bash
curl -s \
  -H "x-geoweedo-admin: $GEOWEEDO_ADMIN_SECRET" \
  http://127.0.0.1:3000/api/admin/database
```

## Backup

Because WAL mode is enabled, use SQLite's backup mechanism or stop GeoWeedo briefly before making a raw filesystem copy. Keep database backups outside the repository. `data/runtime/` remains ignored by Git.

Before enabling real user withdrawals, add scheduled database backups and test a restore on a separate copy.
