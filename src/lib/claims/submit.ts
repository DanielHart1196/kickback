import type { ClaimInsert } from './types';

type ClaimSubmitInput = {
  amount: number | null;
  last4: string;
  referrerInput: string;
  referrerFormatValid: boolean;
  isSelfReferral: boolean;
  referrerLookupStatus: 'idle' | 'checking' | 'valid' | 'invalid';
  referrerProfileId: string | null;
  venueId: string;
  purchaseTime: string;
  now?: number;
};

type ClaimInsertInput = {
  venueName: string;
  venueId: string;
  referrerCode: string | null;
  referrerProfileId: string | null;
  amount: number;
  rates: { guestRate: number; referrerRate: number };
  purchaseTime: string;
  last4: string;
  createdAt: string;
  submitterId: string | null;
  submitterReferralCode: string | null;
};

export const MAX_MANUAL_CLAIM_AGE_MS = 24 * 60 * 60 * 1000;

export function isPurchaseTimeOlderThanMaxAge(purchaseTime: string, now: number = Date.now()): boolean {
  const purchaseDate = new Date(purchaseTime);
  if (Number.isNaN(purchaseDate.getTime())) return false;
  return now - purchaseDate.getTime() > MAX_MANUAL_CLAIM_AGE_MS;
}

export function validateClaimInput(input: ClaimSubmitInput): string | null {
  if (!input.amount || input.amount <= 0) return 'Please enter a valid amount';
  if (input.last4.length !== 4) return 'Please enter 4 digits';
  if (!input.referrerInput.trim()) return 'Please enter a referrer';
  if (!input.referrerFormatValid) return 'Referrer code must be 4-8 letters or numbers';
  if (input.isSelfReferral) return 'You cannot use your own referral code';
  if (input.referrerLookupStatus !== 'valid') return 'Unrecognized referral code';
  if (!input.referrerProfileId) return 'Unrecognized referral code';
  if (!input.venueId) return 'Please select a valid venue';
  if (!input.purchaseTime.trim()) return 'Please enter a purchase time';
  const purchaseDate = new Date(input.purchaseTime);
  if (Number.isNaN(purchaseDate.getTime())) return 'Please enter a valid purchase time';
  const now = input.now ?? Date.now();
  if (purchaseDate.getTime() > now + 60000) return 'Purchase time cannot be in the future';
  if (isPurchaseTimeOlderThanMaxAge(input.purchaseTime, now)) {
    return 'Manual claims can only be submitted within 24 hours of purchase';
  }
  return null;
}

export function buildClaimInsert(input: ClaimInsertInput): ClaimInsert {
  return {
    venue: input.venueName,
    venue_id: input.venueId,
    referrer: input.referrerCode,
    referrer_id: input.referrerProfileId,
    amount: input.amount,
    status: 'pending',
    kickback_guest_rate: input.rates.guestRate,
    kickback_referrer_rate: input.rates.referrerRate,
    purchased_at: new Date(input.purchaseTime).toISOString(),
    last_4: input.last4,
    created_at: input.createdAt,
    submitter_id: input.submitterId,
    submitter_referral_code: input.submitterReferralCode
  };
}
