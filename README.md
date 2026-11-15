# EWS Engine: Early Warning Score system

Staff sign-in (Doctor / Nurse / Admin), live NEWS2-style scoring, emergency alarm with acknowledge and escalation.
React + Flask + MySQL. Live updates use Server-Sent Events.

## Roles
| Role | Can do |
|---|---|
| Nurse, Doctor | View board and alerts, log vitals, add patients, acknowledge/review alerts, change own password |
| Admin | Everything above, plus edit scoring rules, manage staff accounts, run the simulator |

Alerts, alarm and the live stream are served **only to signed-in staff** (signed 12-hour tokens, hashed passwords, lock-out after 5 failed logins).
"Acknowledged by" is taken from the signed-in account, so it cannot be faked.

First start creates three accounts, all with the password in `INITIAL_PASSWORD`: `admin`, `doctor`, `nurse`.
**Sign in as admin, create real accounts, disable or re-password the demo ones.**

## Database (6 tables)
Clinical model, as the supervisor asked: HOSPITAL, WARD, VITAL_PARAMETER, SCORING_RULE, PATIENT. Vital readings and alerts are attributes of PATIENT.
The 6th table, STAFF, is authentication only (who may sign in) and is not part of the clinical ER diagram.

## Deploy with Docker (recommended)
Needs a server (or your laptop) with Docker.
```bash
cp .env.example .env        # then edit: DB_PASSWORD, SECRET_KEY (long random), INITIAL_PASSWORD
docker compose up -d --build
```
Open `http://<server-address>/`. The database tables are created automatically on the first start.
- Update later: `docker compose up -d --build`. Data stays in the `db_data` volume.
- Logs: `docker compose logs -f app`.
- **HTTPS:** patient data needs it on a real network. Put a reverse proxy in front, e.g. Caddy: `your-domain.com { reverse_proxy localhost:8000 }` (and change the compose port mapping to `"8000:8000"`). For live updates, proxies must not buffer `/api/stream` (Caddy is fine as is; nginx needs `proxy_buffering off;`).
- Run exactly **one** app instance. Live updates and the simulator live in that process's memory.
- Real use: set `ENABLE_SIMULATOR=0` so fake readings can never reach a live database.
- Back up with `docker compose exec db mysqldump -uroot -p ews_engine > backup.sql`.

## Run locally without Docker (development)
```bash
mysql -u root -p                     # then inside: source schema.sql;  source seed.sql;   (PowerShell cannot use "<")
cd backend && python -m venv venv && venv\Scripts\activate      # Linux/Mac: source venv/bin/activate
pip install -r requirements.txt
copy .env.example .env               # set DB_PASSWORD; optionally INITIAL_PASSWORD (default ChangeMe123!)
python app.py                        # API on :5000
cd ../frontend && npm install && npm run dev      # open http://localhost:5173
```
If you used an earlier version of this project, run `DROP DATABASE ews_engine;` first, then load both files again (the schema gained the STAFF table).

## Demo (2 minutes)
The interface is a clinical-style ward board (census table with NEWS2-style colour-coded vitals). The alarm is a pager-style run of short beeps; the simulator picks patients fairly at random.
Sign in as `admin` → **Live monitor** → **Enable alarm sound** → **Start simulator**. At a High score (7+) the screen flashes red with a siren
until someone presses **Acknowledge**; after 60 s unacknowledged it escalates. **Alerts → Mark as reviewed** clears it so it can fire again.
Sign in as `nurse` in another browser to show the same alarm and the role limits.

## Rules
Total 7+ High (Emergency alert), 5-6 Medium, else Low; any single vital scoring 3 lifts Low to Medium.
A rising score over 3 readings gives a Warning. Only a more severe alert counts as new (no duplicates). `ESCALATE_AFTER_SECONDS` sets the escalation time.

## Tests
`cd backend && python -m pytest -q tests` (uses the seeded accounts; run on a scratch database, it inserts test patients).
