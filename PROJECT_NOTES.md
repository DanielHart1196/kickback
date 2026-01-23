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
  - “Back to Balance” has arrow icon.
  - Future times are blocked; input `max` is set to now.

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
