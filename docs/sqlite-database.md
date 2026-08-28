# GeoWeedo SQLite application database

GeoWeedo uses one server-side SQLite database at:

`data/runtime/geoweedo.sqlite`

SQLite does **not** have database users, roles, or passwords like PostgreSQL/MySQL. Access to the database file is controlled by the Linux filesystem owner/permissions. GeoWeedo application admins and players are rows inside the database and authenticate through application sessions.

## Initialize the database

From the repository:

```bash
npm install
npm run db:init
```

This creates the database when missing, applies the current additive schema, enables WAL/foreign keys/busy timeout, creates the platform finance tables, and seeds the system YERB accounts.

Check it:

```bash
sqlite3 data/runtime/geoweedo.sqlite '.tables'
sqlite3 data/runtime/geoweedo.sqlite 'SELECT version,name,applied_at FROM schema_migrations ORDER BY version;'
```

On the production host the application user should own the runtime directory and database. For the normal `geo` deployment:

```bash
sudo chown -R geo:geo /home/geo/GeoWeedo/data/runtime
sudo chmod 750 /home/geo/GeoWeedo/data/runtime
sudo chmod 640 /home/geo/GeoWeedo/data/runtime/geoweedo.sqlite
```

Do not create a separate SQLite database username. The `geo` Linux service account is the database file owner; GeoWeedo admin accounts are created in `admin_users`.

## Create the first administrator

The installer prompts for the first administrator automatically. To create or reset one manually without exposing the password in shell history:

```bash
cd ~/GeoWeedo
read -r -p 'Admin username: ' GEOWEEDO_ADMIN_USERNAME
read -r -p 'Admin display name: ' GEOWEEDO_ADMIN_DISPLAY_NAME
read -r -s -p 'Admin password: ' GEOWEEDO_ADMIN_PASSWORD; echo
export GEOWEEDO_ADMIN_USERNAME GEOWEEDO_ADMIN_DISPLAY_NAME GEOWEEDO_ADMIN_PASSWORD
npm run admin:create
unset GEOWEEDO_ADMIN_PASSWORD
```

Admin passwords are salted and scrypt-hashed. Successful login creates a random session token; only its SHA-256 hash is stored in `admin_sessions`. The browser receives an HttpOnly, SameSite cookie. Admin login is at `/admin/login`.

## Player login

Players currently use passwordless Yerbas-wallet authentication:

1. Enter a player display name and public YERB address at `/account`.
2. GeoWeedo creates a short-lived one-time login challenge in `login_challenges`.
3. The player signs that message in the Yerbas wallet.
4. GeoWeedo verifies it with Yerbas Core `verifymessage`.
5. A `users` row, internal `wallets` row, and hashed `user_sessions` session are created.

GeoWeedo never asks for or stores the player's private key or seed phrase.

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

### User YERB balances and payments

- `wallets`
- `wallet_addresses`
- `wallet_ledger`
- `deposits`
- `withdrawals`
- `reward_claims`
- `rpc_jobs`

All YERB amounts are stored as signed integer atomic units (`100,000,000` atomic units per YERB). A user's total balance is the sum of `posted` wallet-ledger entries. Negative `held` entries reserve money for pending withdrawals and reduce the available balance without permanently debiting it.

GeoWeedo must never store a Yerbas wallet seed or spend private key in SQLite. Blockchain signing and broadcasting remain behind the local Yerbas Core wallet RPC.

### Platform / treasury accounting

- `system_accounts`
- `system_ledger`

Default system accounts are:

- `rewards_pool`
- `sponsorship_income`
- `yerb_custody`
- `network_fees`

Player rewards use the same wallet ledger as deposits and withdrawals. Posting a reward creates the player's positive `reward_credit` and a paired platform reward-expense entry. The player can later withdraw that internal balance through the ordinary withdrawal flow.

Activating a paid sponsorship records its unique YERB payment transaction ID and posts the sponsorship amount once to `sponsorship_income`. Sponsorship payment txids and ledger references are protected against duplicate accounting. The current sponsorship activation is administrator-confirmed; automatic on-chain tx verification can be added to the wallet worker later.

## Deposit flow

1. An authenticated player requests a deposit address.
2. GeoWeedo asks the restricted Yerbas wallet RPC for `getnewaddress` and stores the public address in `wallet_addresses`.
3. `scripts/yerb-wallet-worker.mjs` scans wallet receive transactions.
4. Unique `txid + vout` records are inserted/updated in `deposits`.
5. After `YERB_DEPOSIT_CONFIRMATIONS` (default 6), exactly one positive `deposit_credit` is posted to `wallet_ledger`.

Run a manual scan with withdrawals still disabled:

```bash
npm run wallet:worker
```

## Withdrawal flow

1. An authenticated player requests a withdrawal from `/account`.
2. GeoWeedo begins an immediate SQLite transaction, recalculates available balance, and creates a negative `held` ledger entry.
3. The request appears at `/admin/withdrawals`.
4. An administrator approves or rejects it.
5. Rejection releases the hold.
6. Approval only makes the request eligible for the restricted wallet worker.
7. The worker calls `sendtoaddress` only when `YERB_WITHDRAWALS_ENABLED=true`.
8. On success the held entry becomes a posted `withdrawal_debit` with the txid. On failure the hold is released.

Keep this disabled during setup/testing:

```env
YERB_WITHDRAWALS_ENABLED=false
```

## Restricted wallet worker

The installer creates:

- `geoweedo-wallet-worker.service`
- `geoweedo-wallet-worker.timer`

The timer runs the one-shot worker every minute. Check it with:

```bash
sudo systemctl status geoweedo-wallet-worker.timer --no-pager
sudo journalctl -u geoweedo-wallet-worker.service -n 100 --no-pager
```

The web application does not expose an HTTP endpoint that directly invokes `sendtoaddress`.

## Dispensary and map data

- `dispensary_candidates`
- `dispensaries`
- `map_locations`
- `imagery_assets`

Official regulator data enters `dispensary_candidates`. A candidate becomes a playable `dispensary` only after its coordinates and imagery are reviewed. `imagery_assets` can contain KartaView references or GeoWeedo-hosted imagery, including 360 metadata and attribution.

## Gameplay

- `games`
- `game_rounds`
- `daily_challenges`
- `daily_challenge_rounds`
- `leaderboard_entries`
- `favorites`

The production direction is server-authoritative games: the server selects rounds, stores an opaque round token, calculates distance and score after each submitted guess, and creates eligible reward credits only after a game is completed and validated. The database schema supports this, but the current client game has not yet been fully migrated to that server-authoritative flow.

## Community and commercial features

- `sponsorships`
- `notifications`

Sponsorship affects location selection priority only. It must not change geographic score or player reward rate.

## Database health endpoint

`GET /api/admin/database`

This now requires a valid GeoWeedo admin session cookie, not the removed shared admin secret. Open the endpoint after signing into `/admin/login`, or inspect the DB directly with `sqlite3` on the server.

## Install / upgrade

A fresh install can use:

```bash
git clone https://github.com/The-Yerbas-Endeavor/GeoWeedo.git
cd GeoWeedo
sudo bash install.sh
```

The installer initializes SQLite, generates the application session secret, prompts for the first administrator, installs the application service, and installs the wallet-worker timer. On an existing deployment it preserves an existing Nginx site file so Certbot/TLS configuration is not overwritten.

## Backup

Because WAL mode is enabled, use SQLite's backup command rather than copying only the main database file while GeoWeedo is running:

```bash
mkdir -p ~/geoweedo-backups
sqlite3 data/runtime/geoweedo.sqlite ".backup '$HOME/geoweedo-backups/geoweedo-$(date +%F-%H%M%S).sqlite'"
```

Keep backups outside the repository and protect them like financial/account data. Before enabling real user withdrawals, test both backup and restore procedures on a separate copy.
