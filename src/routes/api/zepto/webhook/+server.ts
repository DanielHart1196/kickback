import { json } from '@sveltejs/kit';
import { createHmac, timingSafeEqual } from 'crypto';
import { env } from '$env/dynamic/private';
import { supabaseAdmin } from '$lib/server/supabaseAdmin';

const agreementStateByEvent: Record<string, string> = {
  'payto_agreement.activated': 'active',
  'payto_agreement.declined': 'declined',
  'payto_agreement.expired': 'expired',
  'payto_agreement.cancelled': 'cancelled',
  'payto_agreement.suspended': 'suspended',
  'payto_agreement.reactivated': 'active'
};

const paymentStateByEvent: Record<string, string> = {
  'payto_payment.settled': 'settled',
  'payto_payment.failed': 'failed',
  'payto_payment.under_investigation': 'under_investigation',
  'payto_payment.pending': 'pending'
};

const refundStatusByEvent: Record<string, string> = {
  'payto_refund.processed': 'processed',
  'payto_refund.failed': 'failed'
};

const signatureToleranceSeconds = 300;

function hasValidSignature(secret: string, signatureHeader: string, body: string): boolean {
  const parts = signatureHeader.split('.');
  if (parts.length < 2) return false;
  const timestamp = parts[0];
  const signatures = parts.slice(1).filter(Boolean);
  if (!timestamp || signatures.length === 0) return false;
  const timestampValue = Number(timestamp);
  if (!Number.isFinite(timestampValue)) return false;
  const nowSeconds = Math.floor(Date.now() / 1000);
  if (Math.abs(nowSeconds - timestampValue) > signatureToleranceSeconds) return false;

  const signedPayload = `${timestamp}.${body}`;
  const expected = createHmac('sha256', secret).update(signedPayload).digest('hex');
  const expectedBuffer = Buffer.from(expected, 'hex');

  return signatures.some((signature) => {
    const signatureBuffer = Buffer.from(signature, 'hex');
    if (signatureBuffer.length !== expectedBuffer.length) return false;
    return timingSafeEqual(signatureBuffer, expectedBuffer);
  });
}

function inferResourceType(eventType: string | null, resourceType: string | null): string | null {
  if (resourceType) return resourceType;
  if (!eventType) return null;
  if (eventType.startsWith('payto_agreement')) return 'payto_agreement';
  if (eventType.startsWith('payto_payment')) return 'payto_payment';
  if (eventType.startsWith('payto_refund')) return 'payto_refund';
  return null;
}

export async function POST({ request }) {
  const secret = env.PRIVATE_ZEPTO_WEBHOOK_SECRET ?? '';
  const signatureHeader = request.headers.get('Split-Signature') ?? '';
  const requestId = request.headers.get('Split-Request-ID') ?? null;
  const body = await request.text();
  if (secret && signatureHeader) {
    if (!hasValidSignature(secret, signatureHeader, body)) {
      return json({ ok: false, error: 'invalid_signature' }, { status: 401 });
    }
  } else if (secret) {
    const authHeader = request.headers.get('authorization') ?? '';
    if (authHeader !== `Bearer ${secret}`) {
      return json({ ok: false, error: 'unauthorized' }, { status: 401 });
    }
  }

  const payload = JSON.parse(body);
  if (!payload?.data) {
    return json({ ok: false, error: 'invalid_payload' }, { status: 400 });
  }

  const rawData = payload.data ?? {};
  const dataItems = Array.isArray(rawData) ? rawData : [rawData];
  const now = new Date().toISOString();

  for (let index = 0; index < dataItems.length; index += 1) {
    const data = dataItems[index] ?? {};
    const eventId = data.id ?? (requestId ? `${requestId}:${index}` : null);
    const eventType = data.type ?? payload.event?.type ?? null;
    const resourceUid = data.resource_uid ?? data.uid ?? data.id ?? null;
    const resourceType = inferResourceType(eventType, data.resource_type ?? null);
    const publishedAt = data.published_at
      ? new Date(data.published_at).toISOString()
      : payload.event?.at
        ? new Date(payload.event.at).toISOString()
        : null;

    const eventRecord = {
      event_id: eventId,
      event_type: eventType,
      resource_uid: resourceUid,
      resource_type: resourceType,
      published_at: publishedAt,
      payload
    };

    if (eventId) {
      const { error } = await supabaseAdmin
        .from('zepto_webhook_events')
        .upsert(eventRecord, { onConflict: 'event_id' });
      if (error) {
        return json({ ok: false, error: error.message }, { status: 500 });
      }
    } else {
      const { error } = await supabaseAdmin.from('zepto_webhook_events').insert(eventRecord);
      if (error) {
        return json({ ok: false, error: error.message }, { status: 500 });
      }
    }

    if (!resourceUid || !resourceType || !eventType) {
      continue;
    }

    if (resourceType === 'payto_agreement') {
      const nextState = agreementStateByEvent[eventType];
      const updates: Record<string, unknown> = {
        uid: resourceUid,
        last_event_type: eventType,
        last_webhook_at: now,
        last_webhook_body: data.body ?? null,
        updated_at: now
      };

      if (nextState) updates.state = nextState;
      if (data.body?.mms_agreement_id) {
        updates.mms_agreement_id = data.body.mms_agreement_id;
      }
      if (data.body?.reason) {
        updates.state_reason = data.body.reason;
      }
      if (data.body?.caused_by) {
        updates.state_caused_by = data.body.caused_by;
      }

      const { error } = await supabaseAdmin
        .from('zepto_payto_agreements')
        .upsert(updates, { onConflict: 'uid' });
      if (error) {
        return json({ ok: false, error: error.message }, { status: 500 });
      }
    }

    if (resourceType === 'payto_payment') {
      const nextState = paymentStateByEvent[eventType];
      const updates: Record<string, unknown> = {
        uid: resourceUid,
        last_event_type: eventType,
        last_webhook_at: now,
        last_webhook_body: data.body ?? null,
        updated_at: now
      };

      if (nextState) updates.state = nextState;
      if (data.body?.failure) {
        updates.failure = data.body.failure;
      }

      const { error } = await supabaseAdmin
        .from('zepto_payto_payments')
        .upsert(updates, { onConflict: 'uid' });
      if (error) {
        return json({ ok: false, error: error.message }, { status: 500 });
      }
    }

    if (resourceType === 'payto_refund') {
      const nextStatus = refundStatusByEvent[eventType];
      const updates: Record<string, unknown> = {
        uid: resourceUid,
        last_event_type: eventType,
        last_webhook_at: now,
        last_webhook_body: data.body ?? null,
        updated_at: now
      };

      if (nextStatus) updates.status = nextStatus;

      const { error } = await supabaseAdmin
        .from('zepto_payto_refunds')
        .upsert(updates, { onConflict: 'uid' });
      if (error) {
        return json({ ok: false, error: error.message }, { status: 500 });
      }
    }
  }

  return json({ ok: true });
}
