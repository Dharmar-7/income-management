import { pickAutoLink } from './transaction-match';

describe('pickAutoLink', () => {
  it('auto-links when there is exactly one candidate', () => {
    expect(pickAutoLink(['tx1'])).toBe('tx1');
  });

  it('does NOT auto-link when there are zero candidates', () => {
    expect(pickAutoLink([])).toBeNull();
  });

  it('does NOT auto-link when there are multiple candidates (ambiguous)', () => {
    expect(pickAutoLink(['tx1', 'tx2'])).toBeNull();
    expect(pickAutoLink(['tx1', 'tx2', 'tx3'])).toBeNull();
  });

  it('works with object candidates', () => {
    const only = { id: 'a', amount: 100 };
    expect(pickAutoLink([only])).toBe(only);
  });
});
