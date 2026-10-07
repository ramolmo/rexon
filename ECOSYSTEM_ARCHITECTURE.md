# REXON Business OS — Omnichannel Enterprise Ecosystem Architecture
**Version**: 68.0.0 (Enterprise Multi-Platform Edition)  
**Slogan**: *REXON — Work Smarter. Manage Better.*

---

## 1. System Ecosystem Architecture

REXON is designed as a unified enterprise Business OS operating under the principle of **ONE SYSTEM. ONE DATABASE. ONE BUSINESS LOGIC. ONE USER ACCOUNT. MULTIPLE PLATFORMS.**

```
                             REXON Business OS
                                     │
                 ┌───────────────────┴───────────────────┐
                 │                                       │
              Frontend                                Backend
                 │                                       │
             Web / PWA                              API + Auth
                 │                                       │
                 └───────────────────┬───────────────────┘
                                     │
                                  Database
                 (Supabase PostgreSQL + Turso SQLite Vault)
                                     │
     ┌───────────────────────────────┼───────────────────────────────┐
     │                               │                               │
Android App                    Telegram Bot                 Telegram Mini App
(PWA / TWA Wrapper)       (@rexon_manager_bot)           (Native WebApp SDK)
     │                               │                               │
     └───────────────────────────────┼───────────────────────────────┘
                                     │
                               Notifications
                     (Web Push + In-App + Telegram)
```

---

## 2. Key Architecture Pillars

### A. Telegram Bot Gateway (`server.js`)
- **Bot Username**: `@rexon_manager_bot`
- **Webhook Endpoint**: `POST /api/telegram/webhook`
- **Supported Operational Commands**:
  - `/start` — Welcomes the user, explains capabilities, links Telegram Chat ID to REXON profile, and presents inline WebApp launch button.
  - `/login` — Securely associates Telegram Chat ID with an existing REXON operator email.
  - `/target` — Real-time telemetry for daily 420 target status (Female: 210, Male: 210) and remaining quotas.
  - `/quota` — Displays remaining hourly stock quota for the active 3-hour window.
  - `/report` — Shows daily report summary across 5 distinct operational streams (Single Female, Single Male, Target Female, Target Male, Remaining Female).
  - `/finance` — Displays current ledger balance, integer-cent deterministic cashflow, and recent journal entries.
  - `/status` — System health telemetry, database connectivity status, and active engine details.
  - `/help` — Full command manual and support resources.

### B. Telegram Mini App (TMA) Integration
- **SDK**: `https://telegram.org/js/telegram-web-app.js`
- **Automatic Initialization**: `Telegram.WebApp.ready()`, `expand()`, `enableClosingConfirmation()`.
- **HMAC-SHA256 Cryptographic Verification Protocol** (`/api/auth/telegram-webapp`):
  1. Telegram passes `initData` containing signed user parameters and a `hash`.
  2. The server creates a secret key using HMAC-SHA256: `secret_key = HMAC-SHA256("WebAppData", bot_token)`.
  3. Sorts all key-value pairs alphabetically (excluding `hash`).
  4. Computes the verification HMAC-SHA256 hex digest over the sorted `data_check_string`.
  5. Constant-time comparison ensures zero tampering or impersonation before issuing a session token.

### C. Multi-Platform Android & Web Support (PWA / TWA)
- **Web App Manifest**: `manifest.json` configured with `display: "standalone"`, `id: "rexon-business-os"`, corporate theme color `#1e1b4b`, and shortcuts for Quick Target, Finance Ledger, and Duplicate Checker.
- **Service Worker**: `sw.js` with Cache-First strategy for static assets and Network-First strategy for API endpoints, alongside native Push event listeners.
- **Android Ready**: Can be packaged via Trusted Web Activities (TWA) or Android WebView using Bubblewrap / Android Studio directly pointing to the manifest.

### D. Section 73 Deterministic Finance Safety
- **Decimal-Safe Integer-Cent Standard**: Floating-point arithmetic is strictly prohibited for financial calculations. All balances and monetary movements are stored in integer cents (`amount_cents = Math.round(amount * 100)`).
- **Mandatory 9-Field Transaction Schema**:
  1. `transaction_id`: RFC-4122 compliant UUID / Cryptographic unique identifier.
  2. `created_by`: User email or authenticated agent ID.
  3. `created_at`: Strict ISO-8601 UTC timestamp.
  4. `currency`: Standard 3-letter ISO code (`USD`, `BDT`, `EUR`).
  5. `amount`: Deterministic string formatted to exact 2 decimal places alongside integer cents.
  6. `account`: Ledger account classification (`Primary Operating Wire`, `Escrow Account`, `Tax Reserve`).
  7. `category`: Standard category code (`Client Receivable`, `Payroll Disbursement`, `Infrastructure Operational Cost`).
  8. `reference`: Cross-system tracking reference / invoice number.
  9. `status`: Strict lifecycle state (`COMPLETED`, `PENDING_APPROVAL`, `AUDITED`, `RECONCILED`).

### E. Section 74 Immutable Audit Log System
- **16 Mandatory Logged Categories**:
  `LOGIN`, `LOGOUT`, `FAILED_LOGIN`, `ROLE_CHANGE`, `SALARY_CHANGE`, `PAYROLL_APPROVAL`, `PAYMENT_UPDATE`, `EXPENSE`, `INCOME`, `DATA_EXPORT`, `API_KEY`, `FEATURE_FLAG`, `AI_APPROVAL`, `AUTOMATION`, `CLIENT_CHANGE`, `WORKER_CHANGE`.
- **Tamper-Resistant Storage**: Stored in `system_audit_logs` table with zero UI mutation routes. Entries are append-only.

---

## 3. Database Schema Overview (`schema_telegram_ecosystem.sql`)

### 1. `profiles` Table Extensions
```sql
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS telegram_chat_id BIGINT UNIQUE;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS telegram_username TEXT;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS role TEXT DEFAULT 'user' CHECK (role IN ('admin', 'team_leader', 'user'));
```

### 2. `financial_transactions` Table
```sql
CREATE TABLE IF NOT EXISTS financial_transactions (
    transaction_id VARCHAR(64) PRIMARY KEY,
    created_by VARCHAR(128) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    currency VARCHAR(10) NOT NULL DEFAULT 'USD',
    amount NUMERIC(15, 2) NOT NULL,
    amount_cents BIGINT NOT NULL,
    account VARCHAR(128) NOT NULL,
    category VARCHAR(128) NOT NULL,
    reference VARCHAR(128) NOT NULL,
    status VARCHAR(32) NOT NULL DEFAULT 'COMPLETED',
    metadata JSONB DEFAULT '{}'::jsonb
);
```

### 3. `system_audit_logs` Table
```sql
CREATE TABLE IF NOT EXISTS system_audit_logs (
    log_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    user_id VARCHAR(128) NOT NULL,
    event_type VARCHAR(64) NOT NULL,
    entity_affected VARCHAR(128) NOT NULL,
    change_details TEXT NOT NULL,
    ip_address VARCHAR(45) DEFAULT '127.0.0.1',
    execution_status VARCHAR(32) NOT NULL DEFAULT 'SUCCESS'
);
```

### 4. `notifications` Table
```sql
CREATE TABLE IF NOT EXISTS notifications (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    user_id VARCHAR(128) NOT NULL,
    channel VARCHAR(32) NOT NULL DEFAULT 'in_app', -- 'in_app', 'telegram', 'push', 'all'
    title TEXT NOT NULL,
    body TEXT NOT NULL,
    severity VARCHAR(16) NOT NULL DEFAULT 'info',
    read BOOLEAN NOT NULL DEFAULT FALSE
);
```

---

## 4. API Endpoints Specification

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/health` | System telemetry, uptime, database configuration status. |
| `POST` | `/api/auth/telegram-webapp` | Validates Telegram WebApp `initData` via HMAC-SHA256 and authenticates user. |
| `POST` | `/api/telegram/webhook` | Handles incoming bot commands (`/start`, `/target`, `/quota`, `/report`, `/finance`, etc.). |
| `POST` | `/api/notify/dispatch` | Dispatches omnichannel notification to In-App, Push, and Telegram Bot. |
| `POST` | `/api/finance/transaction` | Creates deterministic, integer-cent safe financial transaction record. |
| `GET` | `/api/audit/logs` | Fetches immutable system audit log trail (admin only). |

---

## 5. Deployment Guide

### Local Development
```bash
# Clone and enter directory
cd work_manager_app

# Start the Node.js zero-dependency backend server
npm start
# Server listens on http://localhost:3000
```

### Docker Deployment
```bash
# Build the Docker image
docker build -t rexon-business-os .

# Run container with environment configuration
docker run -d -p 3000:3000 --env-file .env rexon-business-os
```

### Docker Compose
```bash
docker-compose up -d
```

### Cloud Platform Deployment
- **Render**: Included `render.yaml` and `Procfile` configured for automated zero-configuration deployment.
- **Vercel**: Included `vercel.json` maps static files and directs `/api/*` requests to `server.js`.

---

## 6. Environment Variables (`.env`)

```ini
PORT=3000
NODE_ENV=production
TELEGRAM_BOT_TOKEN="your_telegram_bot_token_here"
TELEGRAM_WEBHOOK_SECRET="optional_webhook_secret_signature"
SUPABASE_URL="https://pxejdzlrcesjepndgpyo.supabase.co"
SUPABASE_ANON_KEY="your_supabase_anon_key"
TURSO_DB_URL="https://datafow-ramolmoaran.aws-ap-south-1.turso.io"
TURSO_AUTH_TOKEN="your_turso_auth_token"
```

---

## 7. Verification & Automated Test Suite

Run the full automated test suite anytime using:
```bash
npm test
```
The test suite validates:
1. `tests/test_telegram_auth.js` — Cryptographic HMAC-SHA256 signature verification & tamper prevention.
2. `tests/test_finance_deterministic.js` — Integer-cent precision arithmetic and Section 73 mandatory schema enforcement.
3. `tests/test_api_endpoints.js` — Server telemetry, `/health` ping, and REST transaction lifecycle.
