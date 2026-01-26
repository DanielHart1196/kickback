const ALPHANUM = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';

export function normalizeReferralCode(code: string): string {
  return code.trim().toUpperCase();
}

export function isReferralCodeValid(code: string): boolean {
  return /^[A-Z0-9]{4,8}$/.test(normalizeReferralCode(code));
}

export function buildReferralCodeFromEmail(email: string, maxLength = 8): string {
  const username = email.split('@')[0] ?? '';
  const cleaned = username.replace(/[^a-z0-9]/gi, '');
  if (!cleaned) return '';
  const normalized = cleaned.toUpperCase();
  const cappedLength = Math.min(maxLength, 8);
  if (normalized.length >= 4) {
    return normalized.slice(0, cappedLength);
  }
  let value = normalized;
  while (value.length < 4) {
    value += normalized;
  }
  return value;
}

export function generateReferralCode(length = 4): string {
  let value = '';
  for (let i = 0; i < length; i += 1) {
    const index = Math.floor(Math.random() * ALPHANUM.length);
    value += ALPHANUM[index];
  }
  return value;
}
