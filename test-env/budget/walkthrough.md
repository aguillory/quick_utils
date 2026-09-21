# Budget App Refactoring & Bug Fixes

## 1. Loan/Mortgage Paid-Off Percentage Fix
- **Issue**: The utilization percentage for loans and mortgages was previously calculating the percentage *remaining* to pay, but it was being labeled and displayed in the progress bar as the percentage *paid off*.
- **Fix**: Modified `Logic.getDebtStatus` in `test-env/budget/accounts.html` to correctly calculate the paid-off percentage for loans and mortgages as `((limit - balance) / limit) * 100`. The progress bar and the label now accurately reflect how much of the loan has actually been paid off.

## 2. Planner One-Time Payments Fix
- **Issue**: One-time ("custom") payments in the Planner did not allow editing their name/description and couldn't be linked to debt accounts.
- **Fix**: 
  - Updated `test-env/budget/planner.html` so that custom one-time bills display an editable input field for the name.
  - Added a dropdown to link the one-time payment to any existing debt account from `state.masterAccounts.debts`.

## 3. Cross-App Payment Sync (Planner <-> Accounts)
- **Issue**: Logging a payment in the Planner did not affect the actual account balances or inform the Payoff Strategizer, causing double-counting of current-month payments.
- **Fix**:
  - **Planner Sync**: Checking a bill as "paid" in the Planner now automatically deducts the bill amount from the linked debt account's balance and logs the payment under `paid_YYYY_MM` on the debt object. Unchecking it restores the balance.
  - **Accounts Quick Pay**: The `quickPay` buttons in `accounts.html` now also log the payment to `paid_YYYY_MM` in addition to decreasing the balance.
  - **Payoff Strategizer**: Modified the `simulatePayoff` algorithm. In "Month 1" (the current month), the simulator now subtracts any amount already paid this month (`paid_YYYY_MM`) from the minimum payments and available cash. This prevents the strategizer from double-counting payments that have already been made in the current month, ensuring an accurate payoff date.

## 4. Auth Race Condition & Hardcoded UIDs
- **Issue**: The `connection.js` file was blindly triggering `signInAnonymously` on load, creating a race condition with the PIN code (email/password) login system. Furthermore, `getBudgetDoc` calls were hardcoded with a specific UID.
- **Fix**:
  - Removed `signInAnonymously` from `test-env/budget/scripts/connection.js`.
  - Replaced the hardcoded UID string `He35YiePGFeHK298DTrtvvv2ujj1` with `state.user.uid` across all HTML files, ensuring data is scoped to the properly authenticated user.

## Migration to JS Modules / SPA
- Per the user's checklist, migrating away from iframes to a true Single Page Application (SPA) with JS modules is listed as a potential refactoring goal. Given the size of the task, this is left as a future optional improvement once the core bug fixes have been validated in the test environment.
