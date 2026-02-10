import type { LayoutLoad } from './$types';

export const load: LayoutLoad = ({ url }) => {
  const venue = url.searchParams.get('venue') ?? null;
  const ref = url.searchParams.get('ref') ?? null;
  return {
    ogVenue: venue,
    ogRef: ref
  };
};
