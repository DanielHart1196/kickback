const ALPHANUM = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';

export function normalizeReferralCode(code: string): string {
  return code.trim().toUpperCase();
}

export function isReferralCodeValid(code: string): boolean {
  return /^[A-Z0-9]{4,8}$/.test(normalizeReferralCode(code));
}

export function generateReferralCode(length = 4): string {
  let value = '';
  for (let i = 0; i < length; i += 1) {
    const index = Math.floor(Math.random() * ALPHANUM.length);
    value += ALPHANUM[index];
  }
  return value;
}
