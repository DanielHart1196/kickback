import { dev } from '$app/environment';
import { env } from '$env/dynamic/private';

type StripeKeyResolution = {
  key: string | null;
  source: string | null;
  error: string | null;
};

function normalize(value: string | undefined | null): string {
  return String(value ?? '').trim();
}

function isValidStripeSecretKey(value: string): boolean {
  return /^sk_(test|live)_/.test(value);
}

function hasMaskLikeValue(value: string): boolean {
  return /^x+$/i.test(value) || /^\*+$/.test(value);
}

function pick(name: string): { value: string; name: string } | null {
  const value = normalize((env as Record<string, string | undefined>)[name]);
  if (!value) return null;
  return { value, name };
}

function inferLiveMode(): boolean {
  const mode = normalize(env.PRIVATE_STRIPE_MODE).toLowerCase();
  if (mode === 'live' || mode === 'prod' || mode === 'production') return true;
  if (mode === 'test' || mode === 'sandbox' || mode === 'development' || mode === 'dev') return false;
  return !dev;
}

export function resolveStripeSecretKey(options?: { live?: boolean }): StripeKeyResolution {
  const live = options?.live ?? inferLiveMode();

  const shared = pick('PRIVATE_STRIPE_SECRET_KEY') ?? pick('STRIPE_SECRET_KEY');
  const modeSpecific = live
    ? pick('PRIVATE_STRIPE_SECRET_KEY_PROD') ?? pick('STRIPE_SECRET_KEY_PROD')
    : pick('PRIVATE_STRIPE_SECRET_KEY_SANDBOX') ?? pick('STRIPE_SECRET_KEY_SANDBOX');
  const selected = shared ?? modeSpecific;

  if (!selected) {
    return {
      key: null,
      source: null,
      error: `missing_stripe_key(${live ? 'live' : 'test'})`
    };
  }

  if (hasMaskLikeValue(selected.value) || !isValidStripeSecretKey(selected.value)) {
    return {
      key: null,
      source: selected.name,
      error: `invalid_stripe_key_format(${selected.name})`
    };
  }

  return {
    key: selected.value,
    source: selected.name,
    error: null
  };
}

export function getStripeKeyOrThrow(options?: { live?: boolean }): string {
  const resolved = resolveStripeSecretKey(options);
  if (!resolved.key) {
    throw new Error(resolved.error ?? 'missing_stripe_key');
  }
  return resolved.key;
}
