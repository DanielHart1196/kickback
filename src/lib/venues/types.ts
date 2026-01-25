export type Venue = {
  id: string;
  name: string;
  short_code?: string | null;
  logo_url?: string | null;
  kickback_guest?: number | null;
  kickback_referrer?: number | null;
  active?: boolean;
};
