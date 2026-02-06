import type { PageLoad } from './$types';
import { KICKBACK_RATE } from '$lib/claims/constants';
import { calculateKickbackWithRate } from '$lib/claims/utils';

export const load: PageLoad = ({ url }) => {
  const params = url.searchParams;
  const amountRaw = params.get('amount') ?? '';
  const amountValue = Number(amountRaw);
  const rate = KICKBACK_RATE;
  const pendingKickback =
    Number.isFinite(amountValue) && amountValue > 0
      ? calculateKickbackWithRate(amountValue, rate).toFixed(2)
      : null;
  return {
    pendingKickback
  };
};
