import { ImageResponse } from '@vercel/og';
import type { RequestHandler } from './$types';
export const config = { runtime: 'nodejs20.x' };

export const GET: RequestHandler = async ({ url }) => {
  const venue = url.searchParams.get('venue') ?? 'a Great Venue';
  const ref = url.searchParams.get('ref') ?? 'a Friend';

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
          type: 'div',
          props: {
            style: {
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              border: '8px solid #22c55e',
              padding: '48px',
              borderRadius: '24px'
            },
            children: [
              {
                type: 'h1',
                props: {
                  style: { fontSize: 72, fontWeight: 800, marginBottom: 16 },
                  children: 'Kickback'
                }
              },
              {
                type: 'p',
                props: {
                  style: { fontSize: 36, color: '#a1a1aa' },
                  children: `Referral from ${ref}`
                }
              },
              {
                type: 'div',
                props: {
                  style: {
                    display: 'flex',
                    marginTop: 40,
                    background: '#f97316',
                    padding: '16px 32px',
                    borderRadius: '9999px'
                  },
                  children: [
                    {
                      type: 'span',
                      props: {
                        style: { fontSize: 36, fontWeight: 800 },
                        children: `5% OFF @ ${venue}`
                      }
                    }
                  ]
                }
              }
            ]
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
