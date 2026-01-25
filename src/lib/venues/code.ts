const DIGITS = '0123456789';

function normalizeVenueBase(name: string): string {
  const base = name.toUpperCase().replace(/[^A-Z0-9]/g, '');
  return base || 'VENUE';
}

export function buildVenueBase(name: string, maxLength = 12): string {
  return normalizeVenueBase(name).slice(0, maxLength);
}

function randomDigits(count: number): string {
  let value = '';
  for (let i = 0; i < count; i += 1) {
    const index = Math.floor(Math.random() * DIGITS.length);
    value += DIGITS[index];
  }
  return value;
}

export function generateVenueCode(name: string, suffixDigits = 4, maxLength = 12): string {
  const base = buildVenueBase(name, maxLength);
  if (base.length < 4) {
    return `${base}${randomDigits(4 - base.length)}`;
  }
  if (suffixDigits <= 0) return base;
  const trimmed = base.slice(0, Math.max(1, maxLength - suffixDigits));
  return `${trimmed}${randomDigits(suffixDigits)}`;
}
