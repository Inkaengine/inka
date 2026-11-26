import { describe, it, expect } from 'vitest';
import getCurrentFrontendPublicUrl from './getCurrentFrontendPublicUrl';

describe('getCurrentFrontendPublicUrl', () => {
  const saved = [
    { name: 'A', url: 'https://edit.a.example' },
    {
      name: 'B',
      url: 'https://edit.b.example',
      publishUrl: 'https://www.b.example',
    },
  ];

  it('prefers publishUrl for the matched entry', () => {
    expect(
      getCurrentFrontendPublicUrl(saved, 'https://edit.b.example'),
    ).toBe('https://www.b.example');
  });

  it('falls back to the entry url when no publishUrl is set', () => {
    expect(
      getCurrentFrontendPublicUrl(saved, 'https://edit.a.example'),
    ).toBe('https://edit.a.example');
  });

  it('returns null when the editUrl is unknown', () => {
    expect(
      getCurrentFrontendPublicUrl(saved, 'https://stranger.example'),
    ).toBeNull();
  });

  it('returns null when editUrl is missing', () => {
    expect(getCurrentFrontendPublicUrl(saved, null)).toBeNull();
    expect(getCurrentFrontendPublicUrl(saved, undefined)).toBeNull();
  });

  it('strips trailing slashes on the chosen value', () => {
    expect(
      getCurrentFrontendPublicUrl(
        [
          {
            name: 'X',
            url: 'https://x.example/',
            publishUrl: 'https://w.x.example/',
          },
        ],
        'https://x.example/',
      ),
    ).toBe('https://w.x.example');
  });
});
