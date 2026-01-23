export type Venue = {
  id: string;
  name: string;
  logo_url?: string | null;
  kickback_guest?: number | null;
  kickback_referrer?: number | null;
  active?: boolean;
};
