import { PasswordService } from '../../src/modules/auth/password.service';

describe('PasswordService (unit)', () => {
  const service = new PasswordService();

  it('hashes a password with a self-describing algorithm prefix', async () => {
    const hash = await service.hash('Kale-2026!Secure#Pass');
    expect(hash.startsWith('$argon2') || hash.startsWith('$2')).toBe(true);
    expect(hash).not.toContain('Kale-2026');
  });

  it('verifies the correct password and rejects a wrong one', async () => {
    const hash = await service.hash('Kale-2026!Secure#Pass');
    await expect(service.verify(hash, 'Kale-2026!Secure#Pass')).resolves.toBe(true);
    await expect(service.verify(hash, 'kale-2026!Secure#pass')).resolves.toBe(false);
    await expect(service.verify(hash, '')).resolves.toBe(false);
  });

  it('produces a different hash for the same password (per-password salt)', async () => {
    const [a, b] = await Promise.all([service.hash('SamePass-123!aaa'), service.hash('SamePass-123!aaa')]);
    expect(a).not.toEqual(b);
  });

  it('fails closed on an unknown or malformed hash instead of throwing', async () => {
    await expect(service.verify('not-a-hash', 'anything')).resolves.toBe(false);
    await expect(service.verify('$9x$broken', 'anything')).resolves.toBe(false);
  });
});
