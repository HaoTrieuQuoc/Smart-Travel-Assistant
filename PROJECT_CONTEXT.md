# PROJECT_CONTEXT.md — Smart Travel Assistant

> **Purpose:** Single-source-of-truth technical reference for AI assistants and engineers to immediately understand the entire architecture, codebase, infrastructure, data schemas, RBAC policies, AI pipelines, testing harness, and operating rules of **Smart Travel Assistant**.

---

## 1. Project Overview

**Smart Travel Assistant** is an enterprise corporate travel automation platform built on **AWS Serverless**, **Node.js 20.x** (zero external npm runtime dependencies in Lambda), **Terraform IaC**, **Slack Block Kit**, **Google Sheets API v4**, and **Multimodal Generative AI (OpenRouter)**.

It automates:
1. **Flight Ticket OCR & Normalization:** Employees upload boarding passes / e-tickets in Slack; Vision AI extracts structured JSON, normalizes IATA codes, names, and prices, and stages a draft.
2. **Interactive Verification & Editing:** Travelers review a Slack Block Kit preview card and can edit 14 enterprise fields via an interactive Modal (`views.open`) or conversational thread replies before committing.
3. **Dual-Write Persistence & Audit:** Confirmed trips (`TRIP-YYYYMM-XXX`) are written simultaneously to **Amazon DynamoDB** (`TravelBookings` with SHA-256 `row_hash`) and **Google Sheets** (`Lịch_Trình_Công_Tác`, 23 columns `A:W`).
4. **Channel-Based RBAC & AI Travel BI Agent:** HR/Admins in `#biz-admin-alerts` (`ADMIN_HR`) can run natural-language BI analytics queries executed deterministically in JavaScript over DynamoDB data (zero LLM math hallucination) and edit saved trips. Employees in `#travel-booking` (`EMPLOYEE`) are restricted to ticket submission and pre-save draft editing.
5. **Autonomous 24h Flight Reminder:** An Amazon EventBridge daily cron triggers `flight_reminder` Lambda at `01:00 UTC` (`08:00 AM GMT+7`), generating destination & luggage checklists via AI, posting alerts to `#biz-admin-alerts`, and marking `reminder_sent = SENT` in both DynamoDB and Google Sheets (Column `U`).

---

## 2. Technology Stack & Constraints

| Layer | Technology / Service | Notes |
|---|---|---|
| **Compute** | AWS Lambda (`nodejs20.x`, 256 MB RAM, 60s timeout) | Zero external `node_modules` in `lambda/`; uses Node 20 built-ins (`https`, `http`, `crypto`) and AWS Lambda runtime's `@aws-sdk/client-dynamodb`, `@aws-sdk/lib-dynamodb`, `@aws-sdk/client-lambda`. |
| **Ingress / API** | Amazon API Gateway HTTP v2 (`$default` stage, auto-deploy) | Routes: `POST /slack/events`, `POST /slack/commands`, `POST /slack/interactions`. |
| **Database** | Amazon DynamoDB (`TravelBookings`, `PAY_PER_REQUEST`) | PK: `trip_id` (`S`). GSI: `DepartureTimeIndex` (`reminder_sent` PK, `departure_time` SK, `ALL` projection). PITR & KMS encryption enabled. |
| **Spreadsheet / Audit** | Google Sheets API v4 | Tab: `Lịch_Trình_Công_Tác` (23 columns `A:W`). Auth via Service Account RSA-SHA256 JWT (`RS256`, 1h token cache). |
| **Scheduler** | Amazon EventBridge (`cron(0 1 * * ? *)`) | Daily at 01:00 UTC (08:00 AM Vietnam Time). |
| **AI Gateway** | OpenRouter API (`/api/v1/chat/completions`) | Vision OCR: `nvidia/nemotron-3.5-super-vl:free`. NLP / BI / Guide: `process.env.AI_MODEL \|\| '@preset/free-model-stack'`. |
| **Chat UI** | Slack Platform (Events, Slash Commands, Block Kit Modals) | HMAC-SHA256 signature verification (`crypto.timingSafeEqual`) + 300s replay-attack window. |
| **IaC** | Terraform (`>= 1.5.0`, AWS provider `~> 5.0`, Archive `~> 2.4`) | Default region: `ap-southeast-2` (Sydney). |
| **Local Dev** | Docker Compose (`amazon/dynamodb-local:latest` on `127.0.0.1:4566`) | Standalone local scripts in `scripts/`. |

---

## 3. Repository Structure

```text
Smart Travel Assistant/
├── AGENTS.md                        # Mandatory workspace rules (QA/QC protocol, Anti-AI persona, quality gates)
├── README.md                        # Public project documentation & FinOps overview
├── PROJECT_CONTEXT.md               # This file — full AI/developer context
├── package.json                     # NPM scripts (test, test:unit, test:e2e, test:visual, lint:syntax, local runners)
├── docker-compose.yml               # Local DynamoDB container on 127.0.0.1:4566
├── .env.example                     # Environment variable template (never commit .env)
├── .gitignore                       # Ignores .env, credentials/*.json, *.tfstate, *.tfvars, dist/, node_modules/, docs/* (except diagrams & Idea.md)
├── plan_test.html                   # Master test plan & verification matrix HTML
├── skill.md                         # Project skill notes
│
├── lambda/                          # Production AWS Lambda source (packaged to terraform/dist/lambda_package.zip)
│   ├── common.js                    # AWS SDK v3 clients, invokeLambdaAsync, makeRequest, Google OAuth2 JWT, Slack API helpers
│   ├── ai_ocr_service.js            # OpenRouter client, cleanJsonResponse, OCR, PR parser, draft/saved-trip editors, BI planner & synthesizer
│   ├── bi_analytics_service.js      # Channel RBAC (ADMIN_HR/EMPLOYEE/UNKNOWN), deterministic BI engine, Block Kit BI report card
│   ├── slack_handler.js             # Main webhook handler (Fast-ACK <100ms + async Event), CITY_MAP, normalization, modals, dual-write
│   └── reminder_cron.js             # EventBridge 24h flight reminder handler + AI travel guide + DynamoDB/Sheets sync
│
├── terraform/                       # AWS Infrastructure as Code
│   ├── main.tf                      # Terraform & AWS provider config (default tags: Project, Environment, ManagedBy)
│   ├── variables.tf                 # Input variables (region, env, tokens, channel IDs, Google Sheet ID, OpenRouter key)
│   ├── outputs.tf                   # API Gateway invoke URLs, DynamoDB ARN/name, Lambda ARNs
│   ├── api_gateway.tf               # HTTP API v2 + routes (/slack/events, /slack/commands, /slack/interactions) + Lambda permission
│   ├── lambda.tf                    # Archive zip + slack_handler & flight_reminder Lambdas (nodejs20.x, 256MB, 60s)
│   ├── dynamodb.tf                  # TravelBookings table + DepartureTimeIndex GSI + PITR + SSE
│   ├── eventbridge.tf               # Daily reminder cron rule + target + Lambda invoke permission
│   ├── iam.tf                       # Lambda execution role, CloudWatch logs, scoped DynamoDB policy, lambda:InvokeFunction policy
│   └── terraform.tfvars.example     # Example tfvars template
│
├── scripts/                         # Local Sprint 1-4 test & utility runners
│   ├── README.md                    # Documentation for local scripts
│   ├── init_and_test.js             # Initialize 23-column Google Sheet & test Slack connection (`npm run init:sheets`)
│   ├── sync_and_audit.js            # Bidirectional sync & SHA-256 hash audit between Sheets & local DynamoDB (`npm run sync:audit`)
│   ├── reminder_worker.js           # Local 24h reminder runner (`npm run reminder`)
│   ├── slack_server.js              # Local HTTP server on port 3000 for webhook testing (`npm run start:local`)
│   ├── ai_ocr_service.js            # Local script helper reading .env
│   ├── test_ai_pr.js                # Test Vietnamese PR NLP extraction (`npm run test:pr`)
│   └── generate_standalone_svg.py   # SVG diagram generator helper
│
├── tests/                           # Automated QA/QC test suites
│   ├── comprehensive_tester.js      # 37 Unit & Integration tests (`npm run test:unit`)
│   ├── e2e_simulation_test.js       # 8 End-to-End flow simulations (`npm run test:e2e`)
│   └── visual_diagram_check.py      # Playwright Chromium visual regression check (`npm run test:visual`)
│
└── docs/
    └── diagrams/smart-travel-assistant/  # AWSketch interactive HTML, SVG, PNG, JSON, sources.md, decisions.md
```

---

## 4. Core Modules & Function Reference (`lambda/`)

### 4.1 `lambda/common.js`
- **AWS Clients:** `ddbClient`, `docClient` (`DynamoDBDocumentClient`), `lambdaClient` (`LambdaClient`) initialized with `AWS_REGION || 'ap-southeast-2'`.
- **Re-exported Commands:** `PutCommand`, `GetCommand`, `DeleteCommand`, `QueryCommand`, `UpdateCommand`, `ScanCommand`.
- `invokeLambdaAsync(functionName, payload)`: Invokes Lambda with `InvocationType: 'Event'` for Slack's `< 3,000ms` Fast-ACK pattern.
- `makeRequest(urlStr, options, postData)`: Zero-dependency `http`/`https` promise wrapper returning `{ status, headers, data | raw }`.
- `getGoogleAccessToken()`: Parses `GOOGLE_SERVICE_ACCOUNT_JSON` (raw JSON or Base64), signs an `RS256` JWT for `spreadsheets` + `drive` scopes, exchanges at `https://oauth2.googleapis.com/token`, caches until 60s before expiry.
- `getSlackUserInfo(userId)`: Calls `users.info` to resolve `@username` and corporate `email`.
- `downloadSlackFile(urlStr)`: Downloads private Slack image buffer with `Authorization: Bearer ${SLACK_BOT_TOKEN}` (follows redirects).
- `getSlackFileInfo(fileId)`, `getRecentChannelFiles(channelId)`, `postSlackMessage(channelId, payload)`, `updateSlackMessage(channelId, ts, payload)`.

### 4.2 `lambda/ai_ocr_service.js`
- `callOpenRouter(payload)`: Calls `https://openrouter.ai/api/v1/chat/completions` using `OPENROUTER_API_KEY`.
- `cleanJsonResponse(rawText)`: Strips ````json` / ```` fences and extracts the outermost `{ ... }` JSON object safely.
- `extractTicketFromBase64(base64Image, mimeType)`: Uses `nvidia/nemotron-3.5-super-vl:free` (`temperature: 0.1`, `reasoning: { effort: 'none' }`) to extract `passenger_name`, `airline`, `flight_number`, `departure_city`, `departure_iata`, `arrival_city`, `arrival_iata`, `departure_time`, `arrival_time`, `pnr`, `ticket_class`, `ticket_price`. Enforces `'Chưa rõ'` if price is missing/`0`/`null`.
- `parsePurchaseRequestChat(userMessage)`: Extracts Vietnamese PR intent (`is_pr_request`, `destination`, `departure_date`, `return_date`, `purpose`, `estimated_cost`).
- `applyConversationalCorrection(currentData, userCorrection)`: Updates a pre-save draft JSON from natural-language user corrections.
- `parseEditSavedTripRequest(userText, existingTrip)`: Parses post-save trip modification requests into `{ is_edit_request, updated_fields, explanation }`.
- `planBIQuery(userQuestion)`: Converts HR admin natural-language questions into a read-only structured query plan `{ is_bi_query, query_type, group_by, filters, limit }`.
- `synthesizeBIInsights(userQuestion, stats)`: Generates 2–3 concise Vietnamese FinOps bullet points (< 80 words, zero emojis) strictly from pre-computed `stats`.

### 4.3 `lambda/bi_analytics_service.js`
- **Channel RBAC (`ROLES`):**
  - `ADMIN_HR`: `channelId === (process.env.SLACK_ADMIN_CHANNEL_ID || 'C0CGLFPNW7R')` (`#biz-admin-alerts`).
  - `EMPLOYEE`: `channelId === (process.env.SLACK_EMPLOYEE_CHANNEL_ID || 'C0CH1CC22FL')` (`#travel-booking`).
  - `UNKNOWN`: Any other channel.
- `buildUnauthorizedMessage(contextType)`: Returns policy-compliant Vietnamese refusal messages for `slash_command`, `edit_saved_trip`, or `general` in `EMPLOYEE` channels.
- `parsePriceVnd(rawPrice)`: Safely parses integer VND; returns `null` for `'Chưa rõ'`, `'null'`, `'n/a'`, empty, or `<= 0`.
- `filterConfirmedTrips(items)`: Excludes system records (`DRAFT#`, `EVENT#`).
- `executeBIQuery(rawItems, plan, nowDate)`: Deterministic JS analytics engine. Supports filters (`month`, `department`, `destination`, `airline`, `passenger_name`, `ticket_class`, `missing_price_only`, `upcoming_days`), groupings (`department`, `airline`, `arrival_city`, `month`), and anomaly detection (missing prices, Business class bookings, outliers `> 1.5x` average when `pricedTrips >= 3`).
- `buildBIReportCard(channelId, threadTs, userQuestion, stats, executiveSummary)`: Renders emoji-free Slack Block Kit BI report card.
- `isLikelyBIQuery(text)`: Regex heuristic detecting Vietnamese/English BI/audit/cost/list queries.

### 4.4 `lambda/slack_handler.js`
- **Security:** `verifySlackSignature(event)` checks `x-slack-signature` (`v0=HMAC-SHA256`) with `crypto.timingSafeEqual` and rejects `x-slack-request-timestamp` older than 300 seconds.
- **Normalization Engine:**
  - `CITY_MAP`: Maps 40+ domestic (VN: `SGN`, `HAN`, `DAD`, `VCA`, `CXR`, `PQC`, `HPH`, `VII`, `HUI`, `DLI`, `BMV`, `UIH`, `VCL`, `THD`, `VDH`, `VCS`, `VKG`, `DIN`, `PXU`, `TBB`) and international (`KUL`, `SIN`, `BKK`, `DMK`, `NRT`, `HND`, `ICN`, `GMP`, `TPE`, `HKG`, `CAN`, `PVG`, `PEK`, `PKX`, `CDG`, `LHR`, `FRA`, `SYD`, `MEL`, `DXB`, `DOH`) IATA codes to standardized city names.
  - `toTitleCase`, `normalizeCity`, `formatPassengerName` (handles `LAST / FIRST`), `normalizeTicketData` (enforces `'Chưa rõ'` for invalid/zero prices; sets enterprise defaults: `department: 'Nhân sự / Quản lý'`, `purpose: 'Công tác nội bộ'`, `payment_method: 'Corporate Card'`).
- **Dual-Write & Update:**
  - `saveTripRecord(tripData)`: Generates `TRIP-YYYYMM-XXX` and `PR-YYYY-XXX`, appends 23 columns to Google Sheets, computes `row_hash = sha256(tripId|passenger_name|flight_number|departure_time)`, writes item to DynamoDB.
  - `updateGoogleSheetAndDynamoTrip(tripId, updatedFields, explanation)`: Updates matching row in Google Sheets (`A{rowIndex}:W{rowIndex}`) and DynamoDB item.
- **Endpoints & Interactive Flows:**
  - `POST /slack/events`: Handles `url_verification`, deduplicates via conditional put on `EVENT#<channelId>#<event.ts>` (Slack fires both `app_mention` and `message.*`), Fast-ACKs and invokes itself asynchronously. Guards against stale channel files triggering OCR on text/BI queries, and scopes draft conversational corrections to matching `thread_ts` so BI queries are not hijacked.
  - `POST /slack/commands`: Handles `/travel-admin` and `/book-travel` (blocked in `EMPLOYEE` channel; opens `travel_booking_modal` in `ADMIN_HR`).
  - `POST /slack/interactions`:
    - Block actions: `confirm_save_ticket`, `open_edit_ticket_modal` (14 input blocks), `cancel_ticket`, `submit_pr_approval`.
    - View submissions: `travel_booking_modal`, `edit_ticket_modal_submit` (updates `DRAFT#<channelId>`, posts new preview card, disables buttons on superseded preview card via `updateSlackMessage`).

### 4.5 `lambda/reminder_cron.js`
- Triggered by EventBridge `daily_flight_reminder`.
- Scans DynamoDB for `status = 'APPROVED'` and `(reminder_sent = 'PENDING' OR attribute_not_exists(reminder_sent))`.
- Filters flights where `departure_time` is in `[now, now + 24h]`.
- Calls `generateAITravelGuide(booking)` (concise Vietnamese checklist, zero emojis).
- Posts Block Kit alert to `SLACK_ADMIN_CHANNEL_ID`.
- Updates DynamoDB (`reminder_sent = 'SENT'`, `last_synced_at`) and Google Sheets Column `U` (`U{rowIndex}`).

---

## 5. Data Schemas

### 5.1 Google Sheets 23-Column Schema (`Lịch_Trình_Công_Tác`, Columns `A`–`W`)
| Col | Index | Field | Example / Default |
|---|---|---|---|
| `A` | 0 | `Trip_ID` | `TRIP-202611-123` |
| `B` | 1 | `PR_Number` | `PR-2026-456` |
| `C` | 2 | `Status` | `APPROVED` |
| `D` | 3 | `Passenger_Name` | `Nguyen Van A` |
| `E` | 4 | `Department` | `Nhân sự / Quản lý` |
| `F` | 5 | `Passenger_Email` | `user@company.com` |
| `G` | 6 | `Slack_Username` | `@username` |
| `H` | 7 | `Airline` | `Vietnam Airlines` |
| `I` | 8 | `Flight_Code` | `VN214` |
| `J` | 9 | `Departure_City` | `Hồ Chí Minh` |
| `K` | 10 | `Departure_IATA` | `SGN` |
| `L` | 11 | `Arrival_City` | `Hà Nội` |
| `M` | 12 | `Arrival_IATA` | `HAN` |
| `N` | 13 | `Departure_Time` | `2026-11-26 08:00` |
| `O` | 14 | `Arrival_Time` | `2026-11-26 10:10` |
| `P` | 15 | `PNR` | `ABC123` |
| `Q` | 16 | `Ticket_Class` | `Economy` |
| `R` | 17 | `Cost_VND` | `1800000` or `Chưa rõ` (never `0`) |
| `S` | 18 | `Payment_Method` | `Corporate Card` |
| `T` | 19 | `Purpose` | `Công tác nội bộ` |
| `U` | 20 | `Reminder_24h` | `PENDING` -> `SENT` |
| `V` | 21 | `Audit_Status` | `VALID` |
| `W` | 22 | `Audit_Notes` | Auto-extraction / AI update audit trail |

### 5.2 Amazon DynamoDB (`TravelBookings`)
- **Primary Key:** `trip_id` (`String`)
  - Confirmed trip: `TRIP-YYYYMM-XXX`
  - Staged draft: `DRAFT#<channelId>` (one active draft per channel; holds normalized ticket data and the preview `thread_ts` used for thread-scoped corrections)
  - Event dedup: `EVENT#<channelId>#<event.ts>` (written with `ConditionExpression: attribute_not_exists(trip_id)`; `ConditionalCheckFailedException` = duplicate Slack delivery, ignored)
- **GSI (`DepartureTimeIndex`):** `reminder_sent` (`S`) + `departure_time` (`S`).

---

## 6. Environment & Terraform Configuration

Required variables in Lambda / `.env` / `terraform.tfvars`:
- `AWS_REGION` (default `ap-southeast-2`), `DYNAMODB_TABLE_NAME` (default `TravelBookings`)
- `SLACK_BOT_TOKEN` (`xoxb-...`), `SLACK_SIGNING_SECRET`
- `SLACK_ADMIN_CHANNEL_ID` (default `C0CGLFPNW7R`), `SLACK_EMPLOYEE_CHANNEL_ID` (default `C0CH1CC22FL`)
- `GOOGLE_SHEET_ID`, `GOOGLE_SHEET_TAB_NAME` (default `Lịch_Trình_Công_Tác`), `GOOGLE_SERVICE_ACCOUNT_JSON` (raw or Base64 JSON for Lambda) / `GOOGLE_SERVICE_ACCOUNT_FILE` (for local `.env`)
- `OPENROUTER_API_KEY`, `AI_MODEL` (default `@preset/free-model-stack`)
- Local-only (`.env.example`): `AI_PROVIDER`, `USE_LOCALSTACK`, `LOCALSTACK_ENDPOINT`, `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`, `SES_SENDER_EMAIL`

---

## 7. Testing, Quality Gates & Workspace Rules (`AGENTS.md`)

1. **Mandatory Quality Gates (run before completing any coding task):**
   - Syntax check: `npm run lint:syntax` (`node --check` on all 5 files in `lambda/`).
   - Automated test suite: `npm test`
     - `tests/comprehensive_tester.js`: 37 unit/integration tests (`TC-NORM-01..08`, `TC-SEC-01..03`, `TC-UI-01..06`, `TC-SHEET-01..04`, `TC-AI-01..03`, `TC-REMIND-01..04`, `TC-MODAL-01..03`, `TC-RBAC-01..02`, `TC-BI-01..04`).
     - `tests/e2e_simulation_test.js`: 8 E2E flows (`E2E-FLOW-01..08`).
   - Visual diagram check (when diagrams change): `npm run test:visual` (`python tests/visual_diagram_check.py`).
2. **Anti-AI Persona:** Strictly NO robotic emojis (`🤖`, `🚀`, `💡`, `🧠`, `✨`) in bot Slack messages, AI prompts, or developer responses.
3. **Response Protocol:** Deliver final technical responses following the 3-section `qa-qc-response-protocol` defined in `AGENTS.md`.
4. **Git Hygiene:** Never commit `.env`, `*.tfvars`, `*.tfstate`, `credentials/*.json`, or `dist/*.zip`. Use Conventional Commits and push to `origin main`.

---

## 8. Key Engineering Invariants & Gotchas

- **Zero Runtime Dependencies in `lambda/`:** Do not introduce `npm install` packages required at runtime inside `lambda/` without updating Terraform packaging; keep `lambda/` dependency-free using Node.js 20 built-ins and Lambda's built-in AWS SDK v3.
- **Missing Ticket Price Rule:** Unprinted or zero prices MUST normalize to `"Chưa rõ"` (never `0` or `0 VND`) so financial aggregations and BI averages are never skewed.
- **Thread-Scoped Draft Corrections:** Conversational draft edits only trigger when the reply's `thread_ts` matches the active draft's `thread_ts` (prevents hijacking admin BI queries in `#biz-admin-alerts`).
- **PowerShell on Windows:** Use `;` instead of `&&` when chaining commands in Windows PowerShell 5.1.
