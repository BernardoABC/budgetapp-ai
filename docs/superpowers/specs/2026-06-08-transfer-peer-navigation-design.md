# Transfer Peer Navigation — Design

## Summary

When viewing or editing a transaction that is already linked as a transfer, the app should:
1. Show the peer account name in the category cell (both read and edit mode).
2. Let the user click the transfer badge/button to navigate to the peer account and scroll to + flash-highlight the specific peer transaction.

## Backend Changes

### 1. `transfer_peer_account_id` in transaction response

**`server/internal/model/transaction.go`** — add one field:
```go
TransferPeerAccountID string // empty if not a transfer
```

**`server/internal/repository/transaction_repo.go` — `ListByAccount` query** — add a lateral join to fetch the peer's account_id:

```sql
LEFT JOIN transactions peer ON peer.id = t.transfer_peer_id
```

Add `COALESCE(peer.account_id::text,'')` to the SELECT list and scan it into `t.TransferPeerAccountID` (inserted just after `t.TransferPeerID` in the `Scan` call).

Apply the same JOIN + SELECT + Scan to the `Get` method (single-transaction fetch) so the field is populated there too.

**`server/internal/handler/transactions.go` — `toResponse`** — add:
```go
"transfer_peer_account_id": t.TransferPeerAccountID, // empty string → nil in JSON
```
(Use the same nil-coercion pattern as `transfer_peer_id`.)

### 2. `highlight_id` param in `ListByAccount`

**`TxnFilter`** — add:
```go
HighlightID string // UUID of the transaction to highlight; empty = no highlight
```

**Handler** — parse `highlight_id` query param and pass it through to `TxnFilter`.

**`ListByAccount`** — when `HighlightID` is non-empty, compute `highlight_page` using a CTE before the main query:

```sql
WITH target AS (
  SELECT date, created_at
  FROM transactions
  WHERE id = $highlightID::uuid AND account_id = $accountID::uuid
),
row_pos AS (
  SELECT COUNT(*) + 1 AS pos
  FROM transactions t, target
  WHERE t.account_id = $accountID::uuid
    AND (
      t.date > target.date
      OR (t.date = target.date AND t.created_at > target.created_at)
    )
)
SELECT pos FROM row_pos
```

`highlight_page = CEIL(pos / per_page)` (integer division, minimum 1). This assumes the default `date_desc` sort; it is accurate for the direct-navigation use case where no extra filters are active.

Include `highlight_page` in the JSON response alongside the existing `pagination` object:
```json
{ "highlight_page": 3 }
```
When `HighlightID` is empty, omit the field (or set it to `null`).

## Frontend Changes

### 1. `Transaction` type and `TxnPage` (`frontend/src/api.ts`)

```ts
// Transaction interface
transfer_peer_account_id?: string | null;

// TxnPage interface
highlight_page?: number | null;
```

`mapApiTxn` maps `transfer_peer_account_id` directly (no unit conversion).

`fetchTransactionsPage` passes through an optional `highlight_id` filter param.

### 2. `Accounts` props (`frontend/src/components/Accounts.tsx`)

Add two props:
```ts
highlightTxnId?: string | null;
onNavigateToTransfer: (peerId: string, peerAccountId: string) => void;
```

### 3. Edit mode — linked transaction display

When `editing` and `t.transfer_peer_id` is set, replace the category `<select>` with:

```tsx
<div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
  <span style={{ fontSize: 10, fontWeight: 700, color: '#6C8EBF', ... }}>
    ⇄ {accountNameById[t.transfer_peer_account_id ?? ''] ?? 'Transfer'}
  </span>
  <button
    onClick={e => { e.stopPropagation(); onNavigateToTransfer(t.transfer_peer_id!, t.transfer_peer_account_id!); }}
    style={/* small ghost button */}
  >→ View</button>
</div>
```

`accountNameById` is derived from `allAccounts` (already available in `Accounts` as `allAccounts = [...accounts.budget, ...accounts.tracking]`).

### 4. Read mode — clickable badge

The existing `⇄ Transfer` `<span>` becomes a `<button>` (or gets an `onClick`) that calls `onNavigateToTransfer`. It stops propagation so it doesn't open edit mode.

### 5. Highlight + scroll logic

In `Accounts`, a `useEffect` watches `[highlightTxnId, page?.transactions]`. When both are set and the target transaction is present in the loaded transactions:
1. Set `pageNum` to `highlight_page` from the API response (this happens in the data-loading `useEffect` that watches the fetch params).
2. After render, find the row by `data-txn-id={t.id}` attribute (add this attribute to each `<tr>`) and call `scrollIntoView({ behavior: 'smooth', block: 'center' })`.
3. Apply a short flash: add a CSS class or inline style that sets background to `rgba(255,220,50,0.25)` and fades to transparent over 1.5 s using a CSS animation defined in `index.css`.

The `highlightTxnId` is cleared (set to `null`) in `App.tsx` after the scroll fires, so navigating back and forward doesn't re-trigger it.

### 6. `App.tsx`

```ts
const [highlightTxnId, setHighlightTxnId] = useState<string | null>(null);

const handleNavigateToTransfer = (peerId: string, peerAccountId: string) => {
  setHighlightTxnId(peerId);
  navigate('accounts', peerAccountId);
};
```

Pass `highlightTxnId` and `onNavigateToTransfer={handleNavigateToTransfer}` to `<Accounts>`.

## Scope

| File | Change |
|------|--------|
| `server/internal/model/transaction.go` | Add `TransferPeerAccountID` field |
| `server/internal/repository/transaction_repo.go` | JOIN peer in `ListByAccount` + `Get`; add `HighlightID` to `TxnFilter`; compute `highlight_page` |
| `server/internal/handler/transactions.go` | Include `transfer_peer_account_id` in `toResponse`; parse `highlight_id`; include `highlight_page` in response |
| `frontend/src/api.ts` | Add `transfer_peer_account_id` to `Transaction`; `highlight_page` to `TxnPage`; pass `highlight_id` param |
| `frontend/src/components/Accounts.tsx` | Edit mode transfer display; read mode clickable badge; scroll+flash logic |
| `frontend/src/App.tsx` | `highlightTxnId` state; `handleNavigateToTransfer` |
| `frontend/src/index.css` | Flash keyframe animation |

No new files. No DB schema changes (no new columns — peer account is derived via JOIN).
