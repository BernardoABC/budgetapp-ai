# PRD 11: Implementation Roadmap

## Overview
This document breaks the project into concrete implementation steps, ordered by dependency. Each step produces a working increment.

## Phase 1: Foundation (MVP)

### Step 1.1: Project Scaffolding
- [ ] Initialize Go module (`server/`)
- [ ] Initialize React + Vite + TypeScript project (`frontend/`)
- [ ] Create `docker-compose.yml` with PostgreSQL, Go server, React dev server
- [ ] Create Dockerfiles for server and frontend
- [ ] Verify `podman compose up` starts all three services
- [ ] Add Tailwind CSS to frontend
- [ ] Set up React Router with placeholder pages

### Step 1.2: Database Schema & Migrations
- [ ] Create migration runner in Go (reads and executes .sql files in order)
- [ ] Write `001_initial_schema.sql` — all tables from PRD 01
- [ ] Write `002_seed_categories.sql` — default category groups and categories
- [ ] Verify migrations run on server startup
- [ ] Add `pgx` as PostgreSQL driver

### Step 1.3: Account Management
- [ ] Go: Account model, repository, handler
- [ ] API: CRUD for accounts
- [ ] React: Sidebar with account list
- [ ] React: Create account modal
- [ ] React: Account balance display
- [ ] Starting balance transaction creation on account create

### Step 1.4: Transaction Management (Manual)
- [ ] Go: Transaction model, repository, handler
- [ ] API: CRUD for transactions with pagination + filtering
- [ ] React: Transaction list table (the main workhorse view)
- [ ] React: Add transaction form
- [ ] React: Inline editing for transaction fields
- [ ] React: Category picker component
- [ ] Account balance updates on transaction CRUD

### Step 1.5: Category Management
- [ ] API: CRUD for categories and category groups
- [ ] React: Category management page (settings)
- [ ] React: Category group collapsible sections

**Milestone: Working app where you can create accounts, add transactions, and manage categories.**

---

## Phase 2: Smart Features

### Step 2.0: Money Model Reconciliation
- [x] Accounts/transactions API speaks native-currency minor units + `currency`
- [x] Remove the colones-at-boundary `÷×100` and the outflow/inflow API split
- [x] Frontend anti-corruption adapter in `api.ts`
- [x] Typed `repository.ErrNotFound` replaces string-matched error checks

### Step 2.1: CSV Parser
(Scope: BAC CSV first, behind a format-agnostic Parser interface. Exchange-rate stamping is deferred to Step 2.4 — imported transactions leave exchange_rate NULL.)

- [ ] Go: CSV parser package (`internal/csvparser/parser.go`)
- [ ] Parse account header section (currency, IBAN, balances)
- [ ] Parse transaction detail section (skip subheader row)
- [ ] Handle DD/MM/YYYY date format (Costa Rican banks)
- [ ] Handle separate debit/credit columns (convert to signed amount)
- [ ] Extract transaction code (TF, CP, PP) for transfer detection
- [ ] Capture running balance per transaction
- [ ] Stop parsing at summary footer section
- [ ] Unit tests with the sample CSV files
- [ ] Handle encoding (Latin-1 / UTF-8)

### Step 2.2: Payee Normalization & Auto-Categorization
- [ ] Go: Payee normalizer (strip bank suffixes, uppercase, collapse whitespace)
- [ ] Go: Categorizer service with exact/prefix/fuzzy matching
- [ ] Payee rules repository
- [ ] Rule learning: update/create rules when user categorizes transactions
- [ ] Unit tests for normalization and matching

### Step 2.3: Import Workflow
- [ ] API: POST /api/imports/preview — parse CSV, run categorization, detect duplicates
- [ ] API: POST /api/imports/confirm — commit transactions, update rules
- [ ] React: Import wizard (file upload → review → confirm)
- [ ] React: Category suggestion display with confidence indicators
- [ ] React: Duplicate warning display
- [ ] React: Bulk accept/override categorization
- [ ] React: Account metadata display from CSV header (currency, balances)

### Step 2.4: Exchange Rate Integration
- [ ] Go: Exchange rate service (fetch from BCCR or exchangerate.host)
- [ ] Exchange rate repository
- [ ] Fetch rates for import transaction dates
- [ ] Daily rate fetch on server startup
- [ ] API: Exchange rate endpoints
- [ ] Manual rate override

### Step 2.5: Currency Toggle
- [ ] React: CurrencyContext provider
- [ ] React: CurrencyToggle component in header
- [ ] React: MoneyDisplay component that converts based on context
- [ ] Persist toggle state in localStorage
- [ ] Apply currency conversion across all views

**Milestone: Import CSV files with auto-categorization, view finances in CRC or USD.**

---

## Phase 3: Budgeting

### Step 3.1: Budget Engine
- [ ] Go: Budget service with monthly calculation logic
- [ ] Calculate: assigned, activity, available per category per month
- [ ] Calculate: Ready to Assign
- [ ] Handle category rollover (available carries forward)
- [ ] API: GET /api/budgets/:month

### Step 3.2: Budget UI
- [ ] React: Budget page with monthly grid
- [ ] Inline editing for assigned amounts
- [ ] Color-coded available (green positive, red negative, yellow warning)
- [ ] Ready to Assign display
- [ ] Month navigation (prev/next)

### Step 3.3: Budget Operations
- [ ] API: Copy from previous month
- [ ] API: Move money between categories
- [ ] React: Move money modal
- [ ] React: Copy from previous month button
- [ ] Click category name → filtered transaction view

**Milestone: Full zero-based budgeting workflow.**

---

## Phase 4: Polish

### Step 4.1: Dashboard
- [ ] API: Dashboard summary endpoint
- [ ] React: Dashboard page with widgets
- [ ] Net worth card
- [ ] Monthly spending card
- [ ] Ready to Assign card
- [ ] Spending by category chart
- [ ] Recent transactions list
- [ ] Budget alerts

### Step 4.2: Reports
- [ ] API: Report endpoints (spending by category, trends, income vs expense, payee spending)
- [ ] React: Reports page with chart views
- [ ] Date range selection
- [ ] Category drill-down

### Step 4.3: UX Polish
- [ ] Search across transactions (payee + memo)
- [ ] Bulk transaction operations (categorize, clear, delete)
- [ ] Transaction cleared toggle
- [ ] Keyboard shortcuts
- [ ] Loading states and error handling
- [ ] Empty states with helpful guidance
- [ ] Toast notifications for actions

### Step 4.4: Data Management
- [ ] Import history view
- [ ] Payee rules management page
- [ ] Data export (CSV)
- [ ] Recurring transaction detection (informational)

**Milestone: Polished, feature-complete personal finance app.**

---

## Technical Debt & Quality (Ongoing)

- [ ] Go: Structured logging (slog)
- [ ] Go: Input validation middleware
- [ ] Go: Graceful shutdown
- [ ] React: Error boundaries
- [ ] React: Loading skeletons
- [ ] End-to-end testing for import workflow
- [ ] Database backup script
