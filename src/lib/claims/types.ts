export type ClaimStatus = 'pending' | 'approved' | 'denied';

export type Claim = {
  id?: string;
  venue: string;
  venue_id?: string | null;
  referrer: string | null;
  referrer_id?: string | null;
  amount: number;
  kickback_guest_rate?: number | null;
  kickback_referrer_rate?: number | null;
  status?: ClaimStatus | null;
  purchased_at: string;
  created_at: string;
  last_4: string;
  square_payment_id?: string | null;
  square_card_fingerprint?: string | null;
  square_location_id?: string | null;
  submitter_id: string | null;
};

export type ClaimInsert = Omit<Claim, 'id'>;

export type ClaimDraft = {
  amount: string;
  venue: string;
  venueId: string;
  venueCode?: string;
  ref: string;
  last4: string;
};
