import { ImageResponse } from '@vercel/og';
import type { RequestHandler } from './$types';
export const config = { runtime: 'nodejs20.x' };

export const GET: RequestHandler = async ({ url }) => {
  const venue = url.searchParams.get('venue') ?? 'a Great Venue';
  const ref = url.searchParams.get('ref') ?? 'a Friend';

  const line = `${ref} wants to give you 5% back on your tab at ${venue}`;

  const element = {
    type: 'div',
    props: {
      style: {
        display: 'flex',
        flexDirection: 'column',
        width: '100%',
        height: '100%',
        alignItems: 'center',
        justifyContent: 'center',
        background: '#0b0b0b',
        color: '#ffffff',
        padding: '80px'
      },
      children: [
        {
          type: 'h1',
          props: {
            style: { fontSize: 88, fontWeight: 800, color: '#f97316', letterSpacing: -1 },
            children: 'Kickback'
          }
        },
        {
          type: 'p',
          props: {
            style: {
              marginTop: 24,
              fontSize: 40,
              color: '#d4d4d8',
              textAlign: 'center',
              lineHeight: 1.3,
              maxWidth: 900
            },
            children: line
          }
        },
        {
          type: 'p',
          props: {
            style: { marginTop: 48, color: '#71717a', fontSize: 28 },
            children: 'kkbk.app'
          }
        }
      ]
    }
  };

  return new ImageResponse(element as any, {
    width: 1200,
    height: 630
  });
};
