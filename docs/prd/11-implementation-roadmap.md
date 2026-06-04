# PRD 11: Implementation Roadmap

## Overview
This document breaks the project into concrete implementation steps, ordered by dependency. Each step produces a working increment.

## Phase 1: Foundation (MVP) ✅

### Step 1.1: Project Scaffolding
- [x] Initialize Go module (`server/`)
- [x] Initialize React + Vite + TypeScript project (`frontend/`)
- [x] Create `docker-compose.yml` with PostgreSQL, Go server, React dev server
- [x] Create Dockerfiles for server and frontend
- [x] Verify `podman compose up` starts all three services
- [x] Custom theme system (replaced Tailwind — CSS-in-JS via `theme.ts`)
- [x] Single-page app with page state machine (replaced React Router)

### Step 1.2: Database Schema & Migrations
- [x] Create migration runner in Go (reads and executes .sql files in order)
- [x] Write `001_initial_schema.sql` — all tables from PRD 01
- [x] Write `002_seed_categories.sql` — default category groups and categories
- [x] Verify migrations run on server startup
- [x] Add `pgx` as PostgreSQL driver

### Step 1.3: Account Management
- [x] Go: Account model, repository, handler
- [x] API: CRUD for accounts
- [x] React: Sidebar with account list
- [x] React: Create account modal
- [x] React: Account balance display
- [x] Starting balance transaction creation on account create

### Step 1.4: Transaction Management (Manual)
- [x] Go: Transaction model, repository, handler
- [x] API: CRUD for transactions with pagination + filtering
- [x] React: Transaction list table (the main workhorse view)
- [x] React: Add transaction form
- [x] React: Inline editing for transaction fields
- [x] React: Category picker component
- [x] Account balance updates on transaction CRUD

### Step 1.5: Category Management
- [x] API: CRUD for categories and category groups
- [x] React: Category management page (settings)
- [x] React: Category group collapsible sections

**Milestone: Working app where you can create accounts, add transactions, and manage categories.** ✅

---

## Phase 2: Smart Features ✅

### Step 2.0: Money Model Reconciliation
- [x] Accounts/transactions API speaks native-currency minor units + `currency`
- [x] Remove the colones-at-boundary `÷×100` and the outflow/inflow API split
- [x] Frontend anti-corruption adapter in `api.ts`
- [x] Typed `repository.ErrNotFound` replaces string-matched error checks

### Step 2.1: CSV Parser
- [x] Go: BAC CSV parser (`internal/importer/bac_csv.go`) behind `Parser` interface
- [x] Parse account header section (currency, IBAN, balances)
- [x] Parse transaction detail section (skip subheader row)
- [x] Handle DD/MM/YYYY date format (Costa Rican banks)
- [x] Handle separate debit/credit columns (convert to signed amount)
- [x] Extract transaction code (TF, CP, PP) for transfer detection
- [x] Capture running balance per transaction
- [x] Stop parsing at summary footer section
- [x] Unit tests with sample CSV files
- [x] Handle encoding (Latin-1 / UTF-8)

### Step 2.2: Payee Normalization & Auto-Categorization
- [x] Go: Payee normalizer (strip bank suffixes, uppercase, collapse whitespace)
- [x] Go: Categorizer service with exact/prefix/fuzzy matching
- [x] Payee rules repository
- [x] Rule learning: update/create rules when user categorizes transactions
- [x] Unit tests for normalization and matching

### Step 2.3: Import Workflow
- [x] API: POST /api/imports/preview — parse CSV, run categorization, detect duplicates
- [x] API: POST /api/imports/confirm — commit transactions, update rules
- [x] React: Import wizard (file upload → review → confirm)
- [x] React: Category suggestion display with confidence indicators
- [x] React: Duplicate warning display
- [x] React: Bulk accept/override categorization
- [x] React: Account metadata display from CSV header (currency, balances)

### Step 2.4: Exchange Rate Integration
- [x] Go: Exchange rate service (BCCR API via `BCCRAPIToken`)
- [x] Exchange rate repository
- [x] Fetch rates for import transaction dates
- [x] API: Exchange rate endpoints (current, nearest, range, upsert)
- [x] Manual rate override

### Step 2.5: Currency Toggle
- [x] React: Currency toggle in header
- [x] Persist toggle state in localStorage
- [x] Apply currency conversion across all views (via `fmt` bound formatter)

**Milestone: Import CSV files with auto-categorization, view finances in CRC or USD.** ✅

---

## Phase 3: Budgeting ✅

### Step 3.1: Budget Engine
- [x] Go: Budget service with monthly calculation logic
- [x] Calculate: assigned, activity, available per category per month
- [x] Calculate: Ready to Assign
- [x] Handle category rollover (available carries forward)
- [x] API: GET /api/budgets/:month

### Step 3.2: Budget UI
- [x] React: Budget page with monthly grid
- [x] Inline editing for assigned amounts
- [x] Color-coded available (green positive, red negative, yellow warning)
- [x] Ready to Assign display
- [x] Month navigation (prev/next)

### Step 3.3: Budget Operations
- [x] API: Copy from previous month
- [x] API: Move money between categories
- [x] React: Move money modal
- [x] React: Copy from previous month button
- [x] Click category name → filtered transaction view

**Milestone: Full zero-based budgeting workflow.** ✅

---

## Phase 4: Polish ✅

### Step 4.1: Dashboard
- [x] React: Dashboard page with widgets
- [x] Net worth card
- [x] Monthly spending card
- [x] Ready to Assign card
- [x] Spending by category chart
- [x] Recent transactions list
- [ ] Budget alerts

### Step 4.2: Reports
- [x] API: Report endpoints (spending by group, income vs expense, net worth)
- [x] React: Reports page with chart views
- [x] Date range selection
- [ ] Category drill-down

### Step 4.3: UX Polish
- [x] Search across transactions (payee + memo)
- [x] Bulk transaction operations (categorize, clear, delete)
- [x] Transaction cleared toggle
- [ ] Keyboard shortcuts
- [x] Loading states and error handling
- [ ] Empty states with helpful guidance
- [ ] Toast notifications for actions

### Step 4.4: Data Management
- [x] Import history view
- [x] Payee rules management page
- [ ] Data export (CSV)
- [ ] Recurring transaction detection (informational)

**Milestone: Polished, feature-complete personal finance app.** ✅ (core complete)

---

---

## Phase 5: Advanced Transaction Features ✅

### Step 5.1: Split Transactions
- [x] DB: `transaction_splits` table (`004_splits_reconcile.sql`)
- [x] API: splits included in GET responses; saved via PUT /api/transactions/:id
- [x] React: Split editor modal on transaction row
- [x] React: ⑂ Split chip badge on split rows

### Step 5.2: Account Reconciliation
- [x] DB: `reconciled` column on transactions (`004_splits_reconcile.sql`)
- [x] API: POST /api/accounts/:id/reconcile (marks cleared txns reconciled, optional adjustment)
- [x] React: Reconcile flow with cleared balance display

### Step 5.3: Linked Transfers ✅ (2026-06-04)
- [x] DB: `transfer_peer_id` self-referential FK on transactions (`005_transfers.sql`)
- [x] API: POST /api/transfers — atomically creates both legs, links peer IDs, adjusts both balances
- [x] Repo: Delete one transfer leg → peer deleted and both balances reversed
- [x] Repo: Update amount on one leg → sign-flipped amount mirrored to peer
- [x] React: "Transfer to another account" toggle in add-transaction form
- [x] React: ⇄ Transfer badge on linked transaction rows

---

## Technical Debt & Quality (Ongoing)

- [ ] Go: Structured logging (slog)
- [ ] Go: Input validation middleware
- [ ] Go: Graceful shutdown
- [ ] React: Error boundaries
- [ ] React: Loading skeletons
- [ ] End-to-end testing for import workflow
- [ ] Database backup script
