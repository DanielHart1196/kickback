# Kickback App Notes (Detailed)

## Product Summary
- Kickback is a claims portal for bar purchases.
- Members submit claims and earn venue-specific kickback percentages.
- Owners manage their venue(s) in `/admin` (pilot: single venue per owner, future: multi-venue).
- Supabase provides auth, data, and storage (logos in a public bucket).

## Core UX and Behavior
- Member claim flow:
  - Venue must exist in `venues` table; venue selection is a datalist.
  - Claims require a referrer; referrer is locked to the first referrer used at that venue.
  - Guest vs member kickback rates are venue-specific.
  - Claims store kickback rates at time of claim to preserve history.
  - On submit, member is returned to dashboard; newest claim fades in and list slides down.
  - Form defaults purchase time to local now; future times are blocked (with max input).
- Admin/Owner flow:
  - `/admin/login` creates/signs in an owner account and sets `profiles.role = owner`.
  - `/admin` guarded; only `owner` or `admin` users allowed.
  - Venue settings panel supports name, logo upload, and kickback % settings.

## Data Model (Supabase)
- `profiles` includes `role` enum: `member`, `owner`, `admin`.
- `venues`:
  - `id` (uuid, pk), `name` (text, unique-ish), `active` (bool),
    `created_by` (uuid), `logo_url` (text),
    `kickback_guest` (numeric), `kickback_referrer` (numeric).
- `venue_owners` join table (future-proof multiple owners per venue).
- `claims`:
  - `venue` (name snapshot at time of claim)
  - `venue_id` (uuid, references venues)
  - `kickback_guest_rate` and `kickback_referrer_rate` (stored at claim time)
  - `purchased_at`, `created_at`, `amount`, `last_4`, `referrer`, `submitter_id`.

## Supabase RLS / Policies (Expected)
- `venues`:
  - Public can read active venues.
  - Owners/admins can create and update their venues.
  - Owners should be able to read their own venues (even if inactive).
- `venue_owners`:
  - Owners/admins can manage their ownership rows.
- `claims`:
  - Users can delete their own claims.
- Admin guard relies on `profiles.role`.

## Storage
- Logos stored in Supabase Storage bucket `venue-logos` (public read for easy display).

## Key Files / Modules
- `src/routes/+page.svelte`
  - Main claim page: handles draft, submit, login redirect, venue lookup, referrer lock.
  - Calculates kickback with per-venue rates.
  - Stores `venue_id` and claim-time rates on insert.
  - Locks referrer to first referrer used for venue (by venue_id when available).
- `src/lib/components/ClaimForm.svelte`
  - Datalist for venues; reward display shows dynamic %.
  - Back button has arrow.
- `src/lib/components/Dashboard.svelte`
  - Uses per-claim stored rates; fallback to venue rate.
  - Shows total kickback at venue + 30-day progress.
  - Remove claim button (red) in details.
- `src/routes/login/+page.svelte`
  - Member login/signup; redirects owner/admin to `/admin`.
  - Pending kickback uses venue guest rate if available.
- `src/routes/admin/+page.svelte`
  - Venue settings panel (logo, name, guest/referrer %).
  - Claims list filtered to owner venue by `venue_id`.
- `src/routes/admin/+layout.svelte`
  - Admin guard (redirects to `/admin/login` or `/`).
- `src/routes/admin/login/+page.svelte`
  - Owner login/signup; sets role to owner; redirects to `/admin`.
- `src/lib/venues/repository.ts`
  - `fetchActiveVenues` returns id, name, logo_url, kickback rates.
- `src/lib/claims/repository.ts`
  - `fetchClaimsForUser`, `fetchClaimsForVenueId`, `insertClaim`, `deleteClaim`.

## UX / Visual Notes
- Orange is the primary accent (replaces green).
- “Kickback” header style: “Kick” white + “back” orange across screens.
- Dashboard:
  - Referrer line: referrer ID white, +$ in orange.
  - “Total kickback at {venue}” shown; 30-day progress bar present.
  - New claim animates in; older claims slide down.
- Referral modal:
  - “Share the Kickback” header uses split color.
  - Share button text set to `text-lg`.
- Claim form:
  - "Back to Balance" has arrow icon.
  - Future times are blocked; input `max` is set to now.
  - Inline validation hints show after blur for venue/referrer/last4.
  - Mobile sticky action bar with larger touch targets.

## SQL Snippets (Used or Expected)
```sql
-- Roles enum
do $$ begin
  create type public.user_role as enum ('member', 'owner', 'admin');
exception
  when duplicate_object then null;
end $$;

alter table public.profiles
  add column if not exists role public.user_role not null default 'member';

-- Venues
create table if not exists public.venues (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  active boolean not null default true,
  created_by uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

alter table public.venues
  add column if not exists logo_url text,
  add column if not exists kickback_guest numeric,
  add column if not exists kickback_referrer numeric;

create table if not exists public.venue_owners (
  venue_id uuid not null references public.venues(id) on delete cascade,
  owner_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (venue_id, owner_id)
);

-- Claims updates
alter table public.claims
  add column if not exists venue_id uuid references public.venues(id),
  add column if not exists kickback_guest_rate numeric,
  add column if not exists kickback_referrer_rate numeric;

-- RLS: allow users to delete own claims
create policy "Users can delete own claims"
on public.claims
for delete
using (auth.uid() = submitter_id);
```

## Known Decisions / Preferences
- Keep claim `venue` name as snapshot (do not update on venue rename).
- Use venue-specific guest/referrer rates; store rates per claim to preserve history.
- Venue selection only from existing venues (no free text).
- Owner onboarding is self-serve via `/admin/login` (no invite code for now).

## TODO / Next Steps (if needed)
- Multi-venue owner UI (list + switch).
- Optional backfill of `venue_id` on historical claims.
- Optional time-based kickback rates per venue (future).

## Recent Session Notes (2026-01-24)
- Refactor: split `src/routes/+page.svelte` into components `Dashboard`, `ClaimForm`, `ReferralModal`, `GuestWarningModal` under `src/lib/components/` to reduce page complexity and keep UI logic isolated.
- Claims helpers: added `src/lib/claims/constants.ts`, `src/lib/claims/types.ts`, `src/lib/claims/utils.ts`, `src/lib/claims/draft.ts`, `src/lib/claims/repository.ts` to centralize math, parsing, draft storage, and Supabase access.
- Dashboard history: added claim time next to date in summary line, added last 4 and referrer earned in details, enlarged history text slightly, removed "Verifying with bank" line.
- Claim form: restored Amount label; submit button disabled until required fields are present (amount, venue, last4, purchase time); explicit disabled styling applied.
- Amount persistence: introduced `amountInput` string binding and on-mount hydration to handle browser back cache so kickback stays correct after navigating back from `/login`.
- Login CTA handoff: `/login` URL now includes amount/venue/ref/last4; login page computes pending kickback from URL or localStorage and shows "Sign up to claim your $xx kickback".
- Login UX: converted inputs into a real `<form>` so Enter submits; added explicit signup/signin toggle with copy changes; removed silent auto-signup from sign-in failures.
- Auth flow: redirect to `/` only when a session exists; error messages now show for sign-in failures; profile upsert performed on auth.
- Session persistence: forced `supabase.auth.setSession(...)` before redirect to help mobile persistence.
- Profile fetch: switched to `.maybeSingle()` to avoid 406 when profile row is missing.
- Logout: always redirects to `/login` even if signOut errors.
- Refer modal: moved into its own component; added mount cleanup to re-enable body scrolling; page mount now resets overlays and scroll to prevent dark unclickable state after refresh.
- UI polish: replaced Svelte favicon with KB monogram in `src/lib/assets/favicon.svg`.
- Supabase config: production Auth URL must be `https://kkbk.app` and Redirect URLs include `https://kkbk.app/*`; mobile auth issues traced to incorrect Site URL and cached site data.
- Key files updated: `src/routes/+page.svelte`, `src/routes/login/+page.svelte`, `src/lib/components/Dashboard.svelte`, `src/lib/components/ClaimForm.svelte`, `src/lib/components/ReferralModal.svelte`, `src/lib/components/GuestWarningModal.svelte`.
- Auth helpers: `handleSignOut()` now always redirects; login `handleAuth()` uses explicit mode and `setSession()` before redirect.
- Draft helpers: `getDraftFromUrl`, `getDraftFromStorage`, `draftToQuery`, `buildDraftFromParams` used in login and claim flow to preserve claim data.
- Claim math helpers: `calculateKickback`, `calculateTotalPending`, `getDaysAtVenue`, `normalizeAmountInput`, `normalizeLast4`, `parseAmount` used across dashboard and form.
- Repository helpers: `fetchClaimsForUser`, `fetchAllClaims`, `insertClaim`, `upsertProfileLast4` centralize Supabase queries.
- Component wiring: `Dashboard` uses `onNewClaim`, `onLogout`, `onOpenRefer`; `ClaimForm` accepts `canSubmit`, `amountInput`, `onAmountHydrate`, `onSubmit`, `onConfirmGuest`; `ReferralModal` handles share/copy and body scroll lock.

## Square OAuth + Auto-Claims (2026-01-27)
- OAuth scopes in use: `ORDERS_READ PAYMENTS_READ MERCHANT_PROFILE_READ` (locations are covered by merchant profile read).
- Redirects:
  - Prod: `https://kkbk.app/api/square/callback`
  - Dev: `http://localhost:5173/api/square/callback`
- Env vars:
  - `PUBLIC_SQUARE_APP_ID_SANDBOX`, `PUBLIC_SQUARE_APP_ID_PROD`
  - `PRIVATE_SQUARE_APP_SECRET_SANDBOX`, `PRIVATE_SQUARE_APP_SECRET_PROD`
  - `PRIVATE_SQUARE_WEBHOOK_SIGNATURE_KEY_SANDBOX`, `PRIVATE_SQUARE_WEBHOOK_SIGNATURE_KEY_PROD`
  - `PRIVATE_SUPABASE_SERVICE_ROLE_KEY`
- Tables added/extended:
  - `square_connections` stores OAuth tokens, `merchant_id`, `expires_at`, `scope`, `token_type`, `last_sync_at`.
  - `claims` includes `square_payment_id`, `square_card_fingerprint`, `square_location_id` for linking auto-claims.
  - `square_location_links` maps Kickback venues to Square location IDs (multi-location support).
- Webhook:
  - Endpoint: `/api/square/webhook`
  - Subscriptions: `payment.created`, `payment.updated`
  - Signature validated against both sandbox/prod keys (supports aliasing URLs).
  - Fetches full payment, matches card fingerprint + venue/location mapping, creates approved claim.
- Manual claim auto-link:
  - On manual claim submit, we attempt to find the matching Square payment and store fingerprint.
  - When matched, claim is auto-approved and shows an "auto-claims supported" popup with days left.
- Admin:
  - Connect/Disconnect Square buttons live alongside "Save Changes".
  - Auto-check Square button appears only when Square is connected.
  - CSV upload hidden when Square is connected (use Auto-check).
  - Location picker appears only when Square connected and there is more than one location.
- Square helpers:
  - `src/lib/server/square/payments.ts` centralizes Square API base selection and payment calls.
  - `src/lib/server/square/webhook.ts` centralizes signature validation.
- New Square API routes:
  - `/api/square/status`, `/api/square/disconnect`, `/api/square/locations`, `/api/square/location-links`
  - `/api/square/payments`, `/api/square/link-claim`, `/api/square/sync`, `/api/square/webhook`

## Auto-Claims Behavior
- Auto-claims are approved by default.
- Card fingerprint links are per user + venue and are established by the first manual claim match.
- New Square payments with a known fingerprint at that venue create claims automatically.
- Multi-location merchants require `square_location_links` entries to avoid mis-attribution.

## Detailed Change Log (2026-01-25 to 2026-01-27)
### Hello Clever PayTo (2026-01-29)
- Added PayTo agreement admin UI in `src/routes/admin/+page.svelte` to create weekly agreements.
- New API routes:
  - `POST /api/helloclever/payto/create` creates agreements and stores them.
  - `POST /api/helloclever/payto/webhook` updates agreement status via webhook.
- New SQL: `sql/venue_payment_agreements.sql` for `venue_payment_agreements` table.
- New env vars:
  - `PRIVATE_HELLOCLEVER_APP_ID_SANDBOX`, `PRIVATE_HELLOCLEVER_SECRET_KEY_SANDBOX`
  - `PRIVATE_HELLOCLEVER_APP_ID_PROD`, `PRIVATE_HELLOCLEVER_SECRET_KEY_PROD`
  - `PRIVATE_HELLOCLEVER_WEBHOOK_SECRET_SANDBOX`, `PRIVATE_HELLOCLEVER_WEBHOOK_SECRET_PROD`
- Sandbox testing notes (PayTo):
  - Hello Clever sandbox returns `422 {"errors":{"message":"Agreement details is invalid."}}` even for the docs’ example payload (PayID-only).
  - When both `bank_account_details` and `pay_id_details` are provided, sandbox returns `422 {"errors":{"message":"Payer details provide either bank_account_details or pay_id_details"}}`.
  - Conclusion: sandbox enforces “one payment method only,” but still rejects the example payload with PayID-only.
  - Likely sandbox validation issue; support ticket submitted with the failing example payload.
  - Admin UI currently sends PayID-only and `payment_agreement_type = OTHER_SERVICE`.

### Square OAuth flow + admin UX
- Added Square connect flow in `src/routes/admin/+page.svelte`:
  - Generates state + venue cookies (`square_oauth_state`, `square_oauth_venue`) with SameSite/secure handling.
  - Uses sandbox/prod app IDs and correct base URLs.
  - Shows success/error banner based on URL params and clears them from history.
- Added `/api/square/callback` handler:
  - Exchanges auth code for tokens in sandbox/prod.
  - Writes to `square_connections` via service role.
  - Redirects to `/admin` with `square=connected|error` and merchant id.
- Added connect/disconnect UI and status polling:
  - `Connect Square` and `Disconnect Square` buttons live alongside "Save Changes".
  - Disconnect revokes token via Square OAuth revoke, then deletes DB row.
  - "Square connected" banner now shown in admin when callback returns.
- OAuth fixes:
  - Localhost state cookies allow SameSite=Lax; HTTPS uses SameSite=None + Secure.
  - Callback allows missing state cookie on localhost, strict elsewhere.
  - Re-throws redirects correctly so callback errors surface.

### Square data storage + schema expectations
- `square_connections` table used for per-venue OAuth storage:
  - `venue_id` unique, `merchant_id`, `access_token`, `refresh_token`, `expires_at`, `scope`, `token_type`, `updated_at`, `last_sync_at`.
- `claims` extended to support Square linkage:
  - `square_payment_id`, `square_card_fingerprint`, `square_location_id`.
- `square_location_links` added to map Kickback venues to Square location IDs for multi-location accounts.

### Square location mapping UX
- Admin location picker added (only visible when connected + more than one location).
- Location picker loads:
  - `/api/square/locations` (Square Locations API)
  - `/api/square/location-links` (stored mapping)
- Save writes full replacement set to `square_location_links`.
- Picker hidden when there is exactly one location or not loaded; errors still surface.

### Auto-check in admin (bulk)
- New "Auto-check Square" bulk action:
  - Visible only when Square is connected.
  - Replaces CSV upload when connected.
  - Fetches Square payments over selected claim date range (±10 mins).
  - Matches by last 4 + amount + time window (±5 mins) and records matches/unmatched.
  - Approve/deny buttons for matched/unmatched claims.
- Matched claims now persist:
  - `square_payment_id`, `square_card_fingerprint`, `square_location_id` written on approval.

### Manual claim -> Square fingerprint link
- On manual claim submission:
  - Attempt Square lookup within ±10 minutes of claim time.
  - If a payment matches (last 4 + amount + ±5 mins), claim is marked `approved` and linked to fingerprint.
  - This makes the card "known" for future auto-claims.
- Auto-claims popup:
  - After a successful claim with a Square match, show a banner:
    - “{venue} supports auto claims… next {daysLeft} days”.
  - Uses the same days-left calculation as the claim detail panel.
  - Auto-dismisses after ~6.5s with a close button.

### Webhook-based auto-claims
- Added `/api/square/webhook`:
  - Validates Square signatures (sandbox + prod keys; handles forwarded host/proto).
  - Handles `payment.created` and `payment.updated`.
  - Fetches payment details with OAuth access token.
  - Matches by card fingerprint + venue/location links.
  - Creates approved claims automatically.
  - Ignores if payment already linked or missing fingerprint fields.
- Webhook signature config:
  - `PRIVATE_SQUARE_WEBHOOK_SIGNATURE_KEY_SANDBOX` + `..._PROD`.
  - Works with one URL aliasing because handler checks both keys.
- Webhook troubleshooting:
  - 404 means route not deployed.
  - 401 means signature mismatch (keys or URL mismatch).
  - 502 means payment fetch failed; handler now retries opposite environment and logs details.

### New server-side helpers (SOLID cleanup)
- `src/lib/server/square/payments.ts`:
  - Centralizes Square API base selection and fetch logic.
  - Provides `fetchSquarePayment` and `listSquarePayments`.
- `src/lib/server/square/webhook.ts`:
  - Centralizes signature validation + public URL reconstruction.
- Route handlers simplified to orchestration (webhook, link-claim, payments, sync).

### Claims logic helpers (SOLID cleanup)
- `src/lib/claims/submit.ts`:
  - `validateClaimInput` and `buildClaimInsert` extracted from the page component.
- `src/lib/claims/match.ts`:
  - `matchClaimsToSquarePayments` extracted from admin bulk flow.

### UI tweaks (admin + member)
- Admin:
  - Disconnect button styled orange to match Connect.
  - Merchant id display removed for cleaner layout.
  - Location picker hidden unless >1 location.
- Member:
  - Auto-claims banner text is centered horizontally/vertically in its card.
  - Auto-claims approval is reflected immediately because link call is awaited before dashboard refresh.

### Endpoint list (Square)
- OAuth:
  - `GET /api/square/callback`
  - `POST /api/square/disconnect`
  - `GET /api/square/status`
- Locations:
  - `GET /api/square/locations`
  - `GET/POST /api/square/location-links`
- Payments:
  - `GET /api/square/payments`
  - `POST /api/square/link-claim`
  - `POST /api/square/sync` (manual backfill; still available even with webhooks)
- Webhook:
  - `POST /api/square/webhook`

### Environment + deployment notes
- Webhooks require a public HTTPS endpoint:
  - Sandbox typically points to preview/alias (e.g., `kickback-ruddy.vercel.app`).
  - Prod points to `https://kkbk.app/api/square/webhook`.
- Ensure both webhook signature keys are set in Vercel.
- Deployments that lack keys will return `missing_signature_key`.

## Workflow Preference
- For schema changes, share SQL directly in chat instead of adding new files, unless explicitly requested.
