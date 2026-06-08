# Account Currency Indicator

## Summary

Add a small muted currency badge (`USD` or `CRC`) to each account row in the sidebar and to the account header on the Accounts page. The badge reflects the account's native currency (`acc.currency`), not the app-level display currency toggle.

## Sidebar (`Layout.tsx` — `AccountRow`)

- Render a small pill between the account name and the balance.
- Only render when `acc.currency` is set.
- Style: ~9.5px font, `T.textFaint` color, subtle border (`T.border`), `T.surface` background, small horizontal padding, rounded corners.
- Text: `"USD"` or `"CRC"` verbatim.

## Accounts Page (`Accounts.tsx`)

- Render the same pill inline after the `<h2>` account name at line 445, vertically aligned center.
- Same visual style as the sidebar badge.
- Only render when `account.currency` is set.

## Style

Both badges share one style definition (or visually identical inline styles):

```
fontSize: 9.5
fontWeight: 600
color: T.textFaint
background: T.surface
border: `1px solid ${T.border}`
borderRadius: 4
padding: '1px 5px'
letterSpacing: '0.04em'
```

## Out of Scope

- No changes to the app-level currency display toggle in the header.
- No changes to how amounts are formatted.
- No changes to the Budget page (which has no per-account display).
