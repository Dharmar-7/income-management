import { checkArticleUrl, extractArticle, htmlToBlocks, isPrivateAddress } from './article.util';

describe('isPrivateAddress', () => {
  it.each(['127.0.0.1', '10.1.2.3', '172.16.0.1', '172.31.255.255', '192.168.1.1', '169.254.169.254', '100.64.0.1', '0.0.0.0', '::1', 'fd00::1', 'fe80::1', '::ffff:10.0.0.1'])(
    'blocks %s', ip => expect(isPrivateAddress(ip)).toBe(true));
  it.each(['8.8.8.8', '151.101.1.69', '172.32.0.1', '2606:4700::6810:84e5'])(
    'allows public %s', ip => expect(isPrivateAddress(ip)).toBe(false));
  it('refuses non-IPs', () => expect(isPrivateAddress('example.com')).toBe(true));
});

describe('checkArticleUrl', () => {
  it('accepts normal article links and drops the fragment', () => {
    expect(checkArticleUrl('https://www.livemint.com/markets/x.html#top')?.toString()).toBe('https://www.livemint.com/markets/x.html');
  });
  it.each([
    'ftp://example.com/a', 'javascript:alert(1)', 'http://localhost/a', 'http://127.0.0.1/a', 'http://[::1]/a',
    'https://user:pw@example.com/', 'https://example.com:8080/', 'http://intranet/a', 'http://metadata.internal/x', 'not a url', '',
  ])('rejects %s', raw => expect(checkArticleUrl(raw)).toBeNull());
});

describe('htmlToBlocks', () => {
  it('keeps order, types blocks, and folds <p> inside <li>/<blockquote>', () => {
    const blocks = htmlToBlocks(`
      <h2>Heading</h2><p>First   para.</p>
      <ul><li><p>Item one</p></li><li>Item two</li></ul>
      <blockquote><p>Quoted line</p></blockquote><p> </p>`);
    expect(blocks).toEqual([
      { type: 'h', text: 'Heading' },
      { type: 'p', text: 'First para.' },
      { type: 'li', text: 'Item one' },
      { type: 'li', text: 'Item two' },
      { type: 'quote', text: 'Quoted line' },
    ]);
  });
});

describe('extractArticle', () => {
  const para = (n: number) => `<p>${'Sensex rose sharply as banks rallied on strong quarterly results. '.repeat(3)}Paragraph ${n}.</p>`;
  const page = (body: string) => `<!doctype html><html><head>
      <title>Markets rally | Mint</title>
      <meta property="og:title" content="Markets rally">
      <meta property="og:image" content="/img/lead.jpg">
      <meta property="og:site_name" content="Mint">
      <meta property="article:published_time" content="2026-11-18T04:30:00Z">
    </head><body><nav><a href="/">Home</a><a href="/markets">Markets</a></nav>
      <article><h1>Markets rally</h1>${body}</article>
      <footer>© Mint. All rights reserved.</footer></body></html>`;

  it('extracts full text, metadata, and an absolute image URL', () => {
    const a = extractArticle(page(Array.from({ length: 8 }, (_, i) => para(i)).join('')), 'https://www.livemint.com/markets/rally.html')!;
    expect(a.title).toBe('Markets rally');
    expect(a.siteName).toBe('Mint');
    expect(a.image).toBe('https://www.livemint.com/img/lead.jpg');
    expect(a.published).toBe('2026-11-18T04:30:00.000Z');
    expect(a.blocks.length).toBe(8);
    expect(a.blocks.some(b => b.text.includes('All rights reserved'))).toBe(false);
    expect(a.partial).toBe(false);
  });

  it('flags a teaser-only page (paywall) as partial', () => {
    const a = extractArticle(page(para(1) + '<p>Subscribe to read the full story.</p>'), 'https://www.livemint.com/x')!;
    expect(a.partial).toBe(true);
  });
});
