# PRD 02: CSV Import & Auto-Categorization

> **Note:** The filename retains the historical `qif` slug. The implemented first format is BAC CSV. A format-agnostic `Parser` interface (`internal/importer`) makes QIF/MT940/fixed-width and other bank formats addable without changing the categorizer or import service.

## Overview
This is the most critical differentiating feature. Users export CSV files from their Costa Rican bank and import them into the app. The system parses the file, detects duplicates, and auto-categorizes transactions based on previously learned payee→category mappings.

## CSV File Format Reference

Based on the actual bank export (`ejemplo_usd.csv` / `ejemplo_crc.csv`):

### File Structure

The bank CSV has three sections:

**1. Account Header (row 1-2)**
```
Numero de Clientes, Nombre, Producto, Moneda, Saldo Inicial, Saldo en Libros, Retenidos y Diferidos, Saldo Disponible, Fecha, STBGAV, STBUNC, Mensaje1, Mensaje2, Mensaje3, Mensaje4, Mensaje5, Mensaje6
2386574, BERNARDO AMILCAR BONILLA CANALES, CR88010200009342364982, USD, 53926.20, 49163.36, 0.00, 49163.36, 31/03/2026, 50477.06, 0.00, , , , , ,
```

**2. Transaction Detail (rows 4+, after blank line and "Detalle de Estado Bancario" subheader)**
```
Fecha de Transaccion, Referencia de Transaccion, Codigo de Transaccion, Descripcion de Transaccion, Debito de Transaccion, Credito de Transaccion, Balance de Transaccion
01/04/2026, 406471624, TF, TEF A : 952432326             , 367.00, 0.00, 53559.20
```

**3. Summary Footer (after blank line and "Resumen de Estado Bancario" subheader)**
```
Codigo Transaccion Totales, Cantidad Debitos Totales, Montos Debitos Totales, Cantidad Creditos Totales, Montos Creditos Totales
TF, 11, 6609.00, 0, 0.00
PP, 0, 0.00, 1, 1846.16
Total, 11, 6609.00, 1, 1846.16
```

### Field Mapping

| CSV Column | Maps To | Notes |
|------------|---------|-------|
| Fecha de Transaccion | transaction.date | **DD/MM/YYYY** format (Costa Rican standard) |
| Referencia de Transaccion | transaction.check_number | Bank reference number |
| Codigo de Transaccion | transaction type hint | `TF` = transfer, `CP` = card purchase, `PP` = payroll/payment, etc. |
| Descripcion de Transaccion | transaction.payee | Raw description string, often padded with spaces |
| Debito de Transaccion | transaction.amount (outflow) | Positive number = money out. Period as decimal separator |
| Credito de Transaccion | transaction.amount (inflow) | Positive number = money in. Period as decimal separator |
| Balance de Transaccion | (used for reconciliation) | Running balance after each transaction |

### Account Header Field Mapping

| CSV Column | Maps To | Notes |
|------------|---------|-------|
| Moneda | account.currency | `CRC` or `USD` |
| Producto | account IBAN | CR IBAN format |
| Saldo Inicial | opening balance | Balance at start of statement period |
| Saldo en Libros | book balance | Current book balance |
| Saldo Disponible | available balance | Available balance after holds |
| Fecha | statement date | Date of the statement (DD/MM/YYYY) |

## Import Workflow

### Step 1: File Upload
- User selects a CSV file via file picker or drag-and-drop
- User selects the target account (or creates a new one)
- File is sent to the API as multipart/form-data

### Step 2: Server-Side Parsing
The Go backend parses the CSV file:

1. **Detect encoding** — Handle Latin-1 and UTF-8 (CR bank exports typically use Latin-1, evidenced by mojibake on accented characters like `o`, `e`, `n`)
2. **Parse account header** — Extract currency, IBAN, and balances from rows 1-2
3. **Skip to transaction detail section** — Find the "Detalle de Estado Bancario" subheader row
4. **Parse each transaction row:**
   - Parse date from DD/MM/YYYY format
   - Extract reference number
   - Extract transaction code (TF, CP, PP, etc.)
   - Extract description (trim trailing whitespace padding)
   - Determine amount: if Debit > 0, amount is negative (outflow); if Credit > 0, amount is positive (inflow)
   - Convert amount to BIGINT minor units (multiply by 100)
   - Store running balance for optional reconciliation
5. **Stop parsing at summary section** — Detect "Resumen de Estado Bancario" and stop
6. **Normalize descriptions** for matching (see below)
7. **Run auto-categorization** against payee_rules
8. **Detect duplicates** against existing transactions

### Step 3: Review & Confirm (Frontend)
The API returns a preview of parsed transactions with:
- Account metadata from CSV header (currency, IBAN, balances)
- Each transaction's parsed data
- Auto-categorization suggestions (with confidence indicator)
- Duplicate warnings
- Summary stats (total inflows, total outflows, date range)

The user can:
- Accept all auto-categorizations
- Override individual category assignments
- Skip/exclude individual transactions
- Manually categorize uncategorized transactions
- Confirm import

### Step 4: Commit
On confirmation:
1. Create an `imports` record
2. Insert all confirmed transactions
3. Update account balance
4. Update/create `payee_rules` based on user's category choices
5. Fetch and store exchange rate for each unique transaction date

## Payee Normalization Algorithm

Bank description strings are messy. The normalization pipeline:

```
Raw:        "WALMART CURRIDABAT OCN00PSAN J"
            |
Step 1:     Trim whitespace padding -> "WALMART CURRIDABAT OCN00PSAN J"
Step 2:     Uppercase -> "WALMART CURRIDABAT OCN00PSAN J"
Step 3:     Remove known bank suffixes -> "WALMART CURRIDABAT"
            (OCN00P, SAN J, LIBER, CURRI, FAC, etc. are location codes)
Step 4:     Collapse whitespace -> "WALMART CURRIDABAT"
Step 5:     Trim -> "WALMART CURRIDABAT"
```

### Known Bank Suffix Patterns to Strip
These are location/terminal identifiers appended by Costa Rican banks:
- `SAN J` (San Jose)
- `LIBER` (Liberia)
- `CURRI` (Curridabat)
- `SANTA` (Santa Ana/Cruz)
- `FAC` (Factura)
- `OCN\d+P` (Online commerce codes)
- Terminal numbers like `40100000`, `40200000`
- Trailing whitespace padding

### Payee Matching Strategy

When a new transaction comes in with description "WALMART CURRIDABAT":

1. **Exact match** — Look up normalized description in `payee_rules`. If found, use that category. Confidence: HIGH.
2. **Prefix match** — If no exact match, check if any existing rule's pattern is a prefix of the new description (or vice versa). E.g., "WALMART" matches "WALMART CURRIDABAT". Confidence: MEDIUM.
3. **Fuzzy match** — Use Levenshtein distance or trigram similarity for close matches. E.g., "OFFICE DEPOT PLAZA CRONOS" vs "OFFICE DEPOT PLAZA CRONOSSAN". Confidence: LOW.
4. **No match** — Transaction is left uncategorized. User must manually assign.

Confidence levels affect the UI:
- **HIGH**: Auto-assigned, shown with green checkmark
- **MEDIUM**: Suggested, shown with yellow indicator — user should confirm
- **LOW**: Suggested with orange indicator — user should verify
- **NONE**: No suggestion, category picker is empty

## Payee Rule Learning

When the user categorizes a transaction (either during import review or later), the system:

1. Normalizes the description string
2. Checks if a `payee_rule` exists for this normalized description
3. If YES: updates `category_id`, increments `match_count`, updates `last_used_at`
4. If NO: creates a new `payee_rule` with `match_count = 1`

This means the system gets smarter with every import. After the first import where the user manually categorizes "WALMART CURRIDABAT" as "Groceries", every future WALMART transaction is auto-categorized.

## Duplicate Detection

To prevent double-importing the same CSV file:

A transaction is considered a **potential duplicate** if ALL of these match an existing transaction in the same account:
- Same date
- Same amount
- Same description (normalized)
- Same reference number (if present)

Duplicates are flagged in the import preview but not automatically excluded — the user decides. This is important because legitimate duplicate transactions do occur (e.g., buying coffee twice at the same place on the same day for the same amount).

## Transfer Detection

Transactions with bank transaction code `TF` (Transfer) in the CSV are likely internal transfers between accounts. The system should:
- Flag these as "Transfer" type in the import preview
- If the user has multiple accounts, suggest linking to the matching inflow/outflow in another account
- Transfers should not count toward budget spending

## API Endpoints

### POST /api/imports/preview
Upload a CSV file and get a parsed preview.

**Request:** multipart/form-data
- `file`: The CSV file
- `account_id`: Target account UUID

**Response:**
```json
{
  "file_info": {
    "filename": "estado_cuenta_abril.csv",
    "currency": "USD",
    "iban": "CR88010200009342364982",
    "opening_balance": 5392620,
    "available_balance": 4916336,
    "statement_date": "2026-03-31",
    "transaction_count": 12,
    "date_range": { "from": "2026-04-01", "to": "2026-04-13" },
    "total_inflow": 184616,
    "total_outflow": -660900
  },
  "transactions": [
    {
      "temp_id": "tmp_1",
      "date": "2026-04-01",
      "amount": -36700,
      "description_raw": "TEF A : 952432326             ",
      "description_normalized": "TEF A 952432326",
      "reference": "406471624",
      "transaction_code": "TF",
      "balance": 5355920,
      "suggested_category": null,
      "duplicate_of": null,
      "is_transfer": true
    }
  ]
}
```

### POST /api/imports/confirm
Commit the reviewed import.

**Request:**
```json
{
  "account_id": "uuid",
  "filename": "estado_cuenta_abril.csv",
  "transactions": [
    {
      "include": true,
      "date": "2026-04-01",
      "amount": -36700,
      "description_raw": "TEF A : 952432326             ",
      "reference": "406471624",
      "category_id": null,
      "payee_override": null,
      "memo": null
    }
  ]
}
```

**Response:**
```json
{
  "import_id": "uuid",
  "imported_count": 10,
  "skipped_count": 2,
  "new_rules_created": 8,
  "rules_updated": 3
}
```

## Edge Cases

1. **Empty file** — Return 400 with clear error message
2. **Malformed CSV** — Parse what's possible, skip malformed rows, report errors in preview
3. **Unknown date format** — Try DD/MM/YYYY first (CR standard), fall back to MM/DD/YYYY
4. **Encoding issues** — Detect and handle Latin-1 (common in CR bank exports) and UTF-8. Convert to UTF-8 internally.
5. **Very large files** — Stream-parse, don't load entire file into memory. Limit to 10,000 transactions per import.
6. **Summary section** — Stop parsing transaction rows when the summary footer is encountered
7. **Missing debit/credit** — If both debit and credit are 0.00, skip the row or flag it
8. **Account header mismatch** — If the CSV header currency doesn't match the selected account's currency, warn the user in the preview
