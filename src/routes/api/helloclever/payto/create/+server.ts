import { json } from '@sveltejs/kit';
import { dev } from '$app/environment';
import { supabaseAdmin } from '$lib/server/supabaseAdmin';
import {
  PRIVATE_HELLOCLEVER_APP_ID_PROD,
  PRIVATE_HELLOCLEVER_APP_ID_SANDBOX,
  PRIVATE_HELLOCLEVER_SECRET_KEY_PROD,
  PRIVATE_HELLOCLEVER_SECRET_KEY_SANDBOX,
  PRIVATE_HELLOCLEVER_WEBHOOK_SECRET_PROD,
  PRIVATE_HELLOCLEVER_WEBHOOK_SECRET_SANDBOX
} from '$env/static/private';

type PayIdType = 'EMAIL' | 'PHONE' | 'ABN';

function normalizePayId(input: string): string {
  return input.trim();
}

function detectPayIdType(input: string): PayIdType | null {
  const trimmed = input.trim();
  if (!trimmed) return null;
  if (trimmed.includes('@')) return 'EMAIL';
  const digits = trimmed.replace(/\D/g, '');
  if (digits.length === 11) return 'ABN';
  if (digits.length >= 8) return 'PHONE';
  return null;
}

const PAYTO_TIMEZONE = 'Australia/Sydney';
const WEEKDAY_INDEX: Record<string, number> = {
  Sun: 0,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6
};

type ZonedParts = {
  year: number;
  month: number;
  day: number;
  weekday: number;
};

function getZonedParts(date: Date, timeZone: string): ZonedParts {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    weekday: 'short'
  });
  const parts = formatter.formatToParts(date);
  const mapped = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  const weekday = WEEKDAY_INDEX[mapped.weekday] ?? 0;
  return {
    year: Number(mapped.year),
    month: Number(mapped.month),
    day: Number(mapped.day),
    weekday
  };
}

function getNextWednesdayParts(timeZone: string): ZonedParts {
  const targetDay = 3; // Wednesday
  const now = new Date();
  const todayParts = getZonedParts(now, timeZone);
  const todayUtc = new Date(Date.UTC(todayParts.year, todayParts.month - 1, todayParts.day));
  let diff = (targetDay - todayParts.weekday + 7) % 7;
  if (diff === 0) diff = 7;
  const targetUtc = new Date(todayUtc.getTime() + diff * 24 * 60 * 60 * 1000);
  return getZonedParts(targetUtc, timeZone);
}

function formatDateSlashFromParts(parts: ZonedParts): string {
  const day = String(parts.day).padStart(2, '0');
  const month = String(parts.month).padStart(2, '0');
  const year = String(parts.year).slice(-2);
  return `${day}/${month}/${year}`;
}

function formatDateIsoFromParts(parts: ZonedParts): string {
  const day = String(parts.day).padStart(2, '0');
  const month = String(parts.month).padStart(2, '0');
  return `${parts.year}-${month}-${day}`;
}

export async function POST({ request, url }) {
  const body = await request.json().catch(() => null);
  const venueId = body?.venue_id;
  const payIdRaw = body?.pay_id;
  const payerName = body?.payer_name;
  const limitAmount = Number(body?.limit_amount ?? 0);
  const description = body?.description;
  const paymentAgreementType = body?.payment_agreement_type;
  const externalId = body?.external_id ?? null;

  const missing = [];
  if (!venueId) missing.push('venue_id');
  if (!payIdRaw) missing.push('pay_id');
  if (!payerName) missing.push('payer_name');
  if (!description) missing.push('description');
  if (!paymentAgreementType) missing.push('payment_agreement_type');
  if (missing.length > 0) {
    return json({ ok: false, error: 'missing_params', missing }, { status: 400 });
  }

  if (!Number.isFinite(limitAmount) || limitAmount <= 0) {
    return json({ ok: false, error: 'invalid_limit_amount' }, { status: 400 });
  }

  const payId = normalizePayId(payIdRaw);
  const payIdType = detectPayIdType(payId);
  if (!payIdType) {
    return json({ ok: false, error: 'invalid_pay_id' }, { status: 400 });
  }

  const appId = dev ? PRIVATE_HELLOCLEVER_APP_ID_SANDBOX : PRIVATE_HELLOCLEVER_APP_ID_PROD;
  const secretKey = dev ? PRIVATE_HELLOCLEVER_SECRET_KEY_SANDBOX : PRIVATE_HELLOCLEVER_SECRET_KEY_PROD;
  const webhookSecret = dev
    ? PRIVATE_HELLOCLEVER_WEBHOOK_SECRET_SANDBOX
    : PRIVATE_HELLOCLEVER_WEBHOOK_SECRET_PROD;

  if (!appId || !secretKey || !webhookSecret) {
    return json({ ok: false, error: 'missing_credentials' }, { status: 500 });
  }

  const frequency = 'MONTHLY';
  const startDateParts = { year: 2024, month: 7, day: 15, weekday: 1 };
  const clientTransactionId =
    (globalThis.crypto && 'randomUUID' in globalThis.crypto
      ? globalThis.crypto.randomUUID()
      : `venue-${venueId}-${Date.now()}`);

  const callbackUrl = new URL('/api/helloclever/payto/webhook', url.origin).toString();

  const payload = {
    client_transaction_id: clientTransactionId,
    limit_amount: limitAmount,
    description,
    external_id: externalId,
    payment_agreement_type: paymentAgreementType,
    agreement_details: {
      variable_agreement_details_obj: {
        start_date: formatDateSlashFromParts(startDateParts),
        frequency
      }
    },
    payer_details: {
      name: payerName,
      pay_id_details: {
        pay_id: payId,
        pay_id_type: payIdType
      }
    },
    payment_agreement_notification: {
      endpoint_url: callbackUrl,
      authorization_header: `Bearer ${webhookSecret}`
    }
  };

  try {
    const response = await fetch('https://api.cleverhub.co/api/v1/pay_to/payment_agreement', {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'Content-Type': 'application/json',
        'app-id': appId,
        'secret-key': secretKey
      },
      body: JSON.stringify(payload)
    });

    const result = await response.json().catch(() => null);
    if (!response.ok) {
      return json(
        { ok: false, error: result ?? 'request_failed' },
        { status: response.status }
      );
    }

    const insertPayload = {
      venue_id: venueId,
      pay_id: payId,
      pay_id_type: payIdType,
      payer_name: payerName,
      limit_amount: limitAmount,
      description,
      external_id: externalId,
      payment_agreement_type: paymentAgreementType,
      agreement_start_date: formatDateIsoFromParts(startDateParts),
      frequency,
      status: result?.status ?? null,
      helloclever_record_id: result?.id ?? null,
      payment_agreement_id: result?.payment_agreement_id ?? null,
      client_transaction_id: result?.client_transaction_id ?? clientTransactionId,
      created_at: result?.created_at ?? new Date().toISOString(),
      last_status_at: new Date().toISOString()
    };

    const { data: stored, error: storeError } = await supabaseAdmin
      .from('venue_payment_agreements')
      .insert(insertPayload)
      .select()
      .single();

    if (storeError) {
      return json({ ok: false, error: storeError.message }, { status: 500 });
    }

    return json({ ok: true, agreement: stored });
  } catch (error) {
    return json(
      { ok: false, error: error instanceof Error ? error.message : 'request_failed' },
      { status: 500 }
    );
  }
}
