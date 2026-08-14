import { signState, verifyState } from './oauth-state';

const SECRET = 'test-hmac-secret';
const NOW = 1_700_000_000_000; // fixed instant

describe('oauth-state', () => {
  it('signs then verifies, returning the uid', () => {
    const state = signState('user_123', SECRET, NOW);
    expect(verifyState(state, SECRET, NOW)).toBe('user_123');
  });

  it('rejects a tampered payload (forged uid)', () => {
    const forged = Buffer.from(JSON.stringify({ uid: 'victim', iat: NOW })).toString('base64url');
    const state = signState('attacker', SECRET, NOW);
    const sig = state.split('.')[1];
    expect(() => verifyState(`${forged}.${sig}`, SECRET, NOW)).toThrow(/signature/i);
  });

  it('rejects a state signed with a different secret', () => {
    const state = signState('user_123', 'other-secret', NOW);
    expect(() => verifyState(state, SECRET, NOW)).toThrow(/signature/i);
  });

  it('rejects an expired state', () => {
    const state = signState('user_123', SECRET, NOW);
    expect(() => verifyState(state, SECRET, NOW + 11 * 60 * 1000)).toThrow(/expired/i);
  });

  it('rejects malformed states', () => {
    expect(() => verifyState('', SECRET, NOW)).toThrow();
    expect(() => verifyState('nodot', SECRET, NOW)).toThrow();
  });
});
