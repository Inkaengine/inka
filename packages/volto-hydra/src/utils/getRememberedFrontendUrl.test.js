import { getRememberedFrontendUrl } from './getRememberedFrontendUrl';

describe('getRememberedFrontendUrl', () => {
  const saved = [
    { name: 'A', url: 'https://a.example' },
    {
      name: 'B',
      url: 'https://edit.b.example',
      publishUrl: 'https://www.b.example',
    },
  ];

  it('keeps a remembered edit URL as it is', () => {
    expect(getRememberedFrontendUrl(saved, 'https://edit.b.example')).toBe(
      'https://edit.b.example',
    );
    expect(getRememberedFrontendUrl(saved, 'https://a.example')).toBe(
      'https://a.example',
    );
  });

  it("opens a frontend's edit URL when the remembered one is its publish URL", () => {
    // The frontend used to be framed at the public address; it now has an
    // editing build of its own, and the public one is only where it publishes.
    expect(getRememberedFrontendUrl(saved, 'https://www.b.example')).toBe(
      'https://edit.b.example',
    );
  });

  it('matches a publish URL whatever its trailing slash', () => {
    expect(getRememberedFrontendUrl(saved, 'https://www.b.example/')).toBe(
      'https://edit.b.example',
    );
    expect(
      getRememberedFrontendUrl(
        [{ ...saved[1], publishUrl: 'https://www.b.example/' }],
        'https://www.b.example',
      ),
    ).toBe('https://edit.b.example');
  });

  it('keeps a remembered URL no saved frontend knows', () => {
    // An editor may have typed any URL into the switcher.
    expect(getRememberedFrontendUrl(saved, 'https://stranger.example')).toBe(
      'https://stranger.example',
    );
  });

  it('remembers nothing when nothing was remembered', () => {
    expect(getRememberedFrontendUrl(saved, undefined)).toBeUndefined();
    expect(getRememberedFrontendUrl(saved, null)).toBeUndefined();
  });
});
