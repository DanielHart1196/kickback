import type { ClaimDraft } from './types';

const STORAGE_KEY = 'pending_claim';

export function buildDraftFromParams(params: URLSearchParams): ClaimDraft {
  return {
    amount: params.get('amount') || '',
    venue: params.get('venue') || '',
    venueId: params.get('venue_id') || '',
    venueCode: params.get('venue_code') || '',
    ref: params.get('ref') || '',
    last4: params.get('last4') || ''
  };
}

export function getDraftFromUrl(search: string): ClaimDraft | null {
  const params = new URLSearchParams(search);
  if (![...params.keys()].length) return null;

  return buildDraftFromParams(params);
}

export function getDraftFromStorage(storage: Storage): ClaimDraft | null {
  const raw = storage.getItem(STORAGE_KEY);
  if (!raw) return null;

  try {
    return JSON.parse(raw) as ClaimDraft;
  } catch {
    return null;
  }
}

export function saveDraftToStorage(storage: Storage, draft: ClaimDraft): void {
  storage.setItem(STORAGE_KEY, JSON.stringify(draft));
}

export function clearDraftFromStorage(storage: Storage): void {
  storage.removeItem(STORAGE_KEY);
}

export function draftToQuery(draft: ClaimDraft): string {
  const params = new URLSearchParams();

  if (draft.amount) params.set('amount', draft.amount);
  if (draft.venue) params.set('venue', draft.venue);
  if (draft.venueCode) params.set('venue_code', draft.venueCode);
  else if (draft.venueId) params.set('venue_id', draft.venueId);
  if (draft.ref) params.set('ref', draft.ref);
  if (draft.last4) params.set('last4', draft.last4);

  return params.toString();
}
