import { createHmac, timingSafeEqual } from 'crypto';
import { env } from '$env/dynamic/private';

type SignatureMatch = {
  valid: boolean;
  publicUrl: string;
  hasSandboxKey: boolean;
  hasProdKey: boolean;
};

function isValidSignature(signature: string, url: string, body: string, key: string): boolean {
  const hmac = createHmac('sha1', key);
  hmac.update(url + body);
  const expected = hmac.digest('base64');
  if (expected.length !== signature.length) return false;
  return timingSafeEqual(Buffer.from(expected), Buffer.from(signature));
}

function buildPublicUrl(request: Request): string {
  const url = new URL(request.url);
  const forwardedHost = request.headers.get('x-forwarded-host') ?? request.headers.get('host');
  const forwardedProto = request.headers.get('x-forwarded-proto') ?? url.protocol.replace(':', '');
  return forwardedHost
    ? `${forwardedProto}://${forwardedHost}${url.pathname}${url.search}`
    : request.url;
}

export function matchSquareSignature(
  request: Request,
  body: string,
  signature: string
): SignatureMatch {
  const sandboxKey = env.PRIVATE_SQUARE_WEBHOOK_SIGNATURE_KEY_SANDBOX;
  const prodKey = env.PRIVATE_SQUARE_WEBHOOK_SIGNATURE_KEY_PROD;
  const publicUrl = buildPublicUrl(request);

  const matchesSandbox =
    (sandboxKey ? isValidSignature(signature, request.url, body, sandboxKey) : false) ||
    (sandboxKey ? isValidSignature(signature, publicUrl, body, sandboxKey) : false);
  const matchesProd =
    (prodKey ? isValidSignature(signature, request.url, body, prodKey) : false) ||
    (prodKey ? isValidSignature(signature, publicUrl, body, prodKey) : false);

  return {
    valid: Boolean(signature) && (matchesSandbox || matchesProd),
    publicUrl,
    hasSandboxKey: Boolean(sandboxKey),
    hasProdKey: Boolean(prodKey)
  };
}
