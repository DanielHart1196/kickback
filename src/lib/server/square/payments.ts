import { env } from '$env/dynamic/private';

export const squareVersion = '2025-01-23';

export type SquarePayment = {
  id: string;
  status?: string;
  created_at?: string;
  location_id?: string;
  amount_money?: { amount: number };
  card_details?: { card?: { last_4?: string; fingerprint?: string; card_fingerprint?: string } };
};

type SquareResponse<T> = {
  ok: boolean;
  status: number;
  payload: T | null;
  baseUrl: string;
};

export function getSquareApiBase(accessToken: string | null | undefined): string {
  if (accessToken?.startsWith('sandbox-')) {
    return 'https://connect.squareupsandbox.com';
  }
  if (env.PUBLIC_SQUARE_ENVIRONMENT === 'sandbox') {
    return 'https://connect.squareupsandbox.com';
  }
  return 'https://connect.squareup.com';
}

async function fetchSquareJson<T>(
  url: string,
  accessToken: string,
  baseUrl: string
): Promise<SquareResponse<T>> {
  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Square-Version': squareVersion,
      Accept: 'application/json'
    }
  });
  const payload = (await response.json().catch(() => null)) as T | null;
  return { ok: response.ok, status: response.status, payload, baseUrl };
}

export async function fetchSquarePayment(accessToken: string, paymentId: string) {
  const primaryBase = getSquareApiBase(accessToken);
  let result = await fetchSquareJson<{ payment?: SquarePayment }>(
    `${primaryBase}/v2/payments/${paymentId}`,
    accessToken,
    primaryBase
  );

  if (!result.ok) {
    const fallbackBase =
      primaryBase === 'https://connect.squareup.com'
        ? 'https://connect.squareupsandbox.com'
        : 'https://connect.squareup.com';
    result = await fetchSquareJson<{ payment?: SquarePayment }>(
      `${fallbackBase}/v2/payments/${paymentId}`,
      accessToken,
      fallbackBase
    );
  }

  return result;
}

export async function listSquarePayments(
  accessToken: string,
  params: {
    begin_time: string;
    end_time: string;
    limit?: number;
    sort_order?: 'ASC' | 'DESC';
    cursor?: string | null;
  }
) {
  const baseUrl = getSquareApiBase(accessToken);
  const url = new URL(`${baseUrl}/v2/payments`);
  url.searchParams.set('begin_time', params.begin_time);
  url.searchParams.set('end_time', params.end_time);
  url.searchParams.set('sort_order', params.sort_order ?? 'ASC');
  url.searchParams.set('limit', String(params.limit ?? 200));
  if (params.cursor) {
    url.searchParams.set('cursor', params.cursor);
  }

  return fetchSquareJson<{ payments?: SquarePayment[]; cursor?: string }>(
    url.toString(),
    accessToken,
    baseUrl
  );
}
