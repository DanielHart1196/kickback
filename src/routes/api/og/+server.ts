import type { RequestHandler } from './$types';
export const config = { runtime: 'nodejs20.x' };
import { readFile } from 'node:fs/promises';

export const GET: RequestHandler = async ({ url }) => {
  const { ImageResponse } = await import('@vercel/og');
  const venue = url.searchParams.get('venue') ?? 'a Great Venue';
  const ref = url.searchParams.get('ref') ?? 'a Friend';

  const line = `${ref} wants to give you 5% back on your tab at ${venue}`;

  const redonda = await readFile(
    new URL('../../../static/fonts/kickback/kickback-black-italic.ttf', import.meta.url)
  );
  const montserrat = await readFile(
    new URL('../../../static/fonts/montserrat/Montserrat-VariableFont_wght.ttf', import.meta.url)
  );

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
            style: {
              fontSize: 88,
              fontWeight: 900,
              fontStyle: 'italic',
              fontFamily: 'Redonda',
              color: '#f97316',
              letterSpacing: -1
            },
            children: 'Kickback'
          }
        },
        {
          type: 'p',
          props: {
            style: {
              marginTop: 24,
              fontSize: 40,
              fontFamily: 'Montserrat',
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
            style: {
              marginTop: 48,
              fontSize: 28,
              fontFamily: 'Montserrat',
              color: '#71717a'
            },
            children: 'kkbk.app'
          }
        }
      ]
    }
  };

  return new ImageResponse(element as any, {
    width: 1200,
    height: 630,
    fonts: [
      { name: 'Redonda', data: redonda, weight: 900, style: 'italic' },
      { name: 'Montserrat', data: montserrat, weight: 800, style: 'normal' }
    ]
  });
};
