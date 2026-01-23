export type Claim = {
  id?: string;
  venue: string;
  referrer: string | null;
  amount: number;
  purchased_at: string;
  created_at: string;
  last_4: string;
  submitter_id: string | null;
};

export type ClaimInsert = Omit<Claim, 'id'>;

export type ClaimDraft = {
  amount: string;
  venue: string;
  ref: string;
  last4: string;
};
