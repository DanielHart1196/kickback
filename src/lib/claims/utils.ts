import { GOAL_DAYS, KICKBACK_RATE } from './constants';
import type { Claim } from './types';

export function calculateKickback(amount: number): number {
  return Number((amount * KICKBACK_RATE).toFixed(2));
}

export function calculateTotalPending(claims: Claim[]): number {
  const totalBills = claims.reduce((sum, c) => sum + (c.amount || 0), 0);
  return calculateKickback(totalBills);
}

export function calculateTotalAmount(claims: Claim[]): number {
  return claims.reduce((sum, c) => sum + Number(c.amount || 0), 0);
}

export function getDaysAtVenue(
  claims: Claim[],
  venueName: string,
  goalDays: number = GOAL_DAYS
): number {
  const venueClaims = claims.filter((c) => c.venue === venueName);
  if (venueClaims.length === 0) return 0;

  const dates = venueClaims.map((c) => new Date(c.purchased_at).getTime());
  const firstDate = Math.min(...dates);
  const now = Date.now();
  const diffInDays = Math.floor((now - firstDate) / (1000 * 60 * 60 * 24));

  return Math.min(diffInDays + 1, goalDays);
}

export function normalizeLast4(value: string): string {
  return value.replace(/\D/g, '').slice(0, 4);
}

export function normalizeAmountInput(raw: string, max: number): string {
  let value = raw.replace(/[^\d.]/g, '');
  const decimalCount = (value.match(/\./g) || []).length;

  if (decimalCount > 1) {
    const firstIndex = value.indexOf('.');
    value =
      value.slice(0, firstIndex + 1) +
      value.slice(firstIndex + 1).replace(/\./g, '');
  }

  if (value.includes('.')) {
    const [whole, decimal] = value.split('.');
    value = `${whole}.${decimal.slice(0, 2)}`;
  }

  const numeric = Number(value);
  if (Number.isFinite(numeric) && numeric > max) {
    return max.toString();
  }

  return value;
}

export function parseAmount(value: string): number | null {
  if (!value) return null;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}
