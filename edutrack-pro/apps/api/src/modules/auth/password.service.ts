import { Injectable, Logger } from '@nestjs/common';

/**
 * Password hashing.
 *
 * Preference order:
 *   1. Argon2id (recommended) via the `argon2` package.
 *   2. bcrypt via the `bcrypt` package when argon2's native module is not
 *      available in the environment.
 *
 * Hashes are self-describing ($argon2id$... or $2b$...), so verification always
 * works regardless of which backend produced the stored hash.
 */
@Injectable()
export class PasswordService {
  private readonly logger = new Logger(PasswordService.name);
  private argon2: typeof import('argon2') | null = null;
  private bcrypt: typeof import('bcrypt') | null = null;
  private resolved = false;

  private async backends(): Promise<void> {
    if (this.resolved) return;
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports -- argon2/bcrypt are optional native backends, loaded lazily
      this.argon2 = require('argon2');
      this.logger.log('Password hashing backend: argon2id');
    } catch {
      this.logger.warn('argon2 unavailable; falling back to bcrypt');
    }
    if (!this.argon2) {
      try {
        // eslint-disable-next-line @typescript-eslint/no-require-imports -- bcrypt is the optional fallback backend, loaded lazily
        this.bcrypt = require('bcrypt');
        this.logger.log('Password hashing backend: bcrypt');
      } catch {
        this.logger.error('Neither argon2 nor bcrypt is installed.');
      }
    }
    this.resolved = true;
  }

  async hash(plain: string): Promise<string> {
    await this.backends();
    if (this.argon2) {
      return this.argon2.hash(plain, {
        type: this.argon2.argon2id,
        memoryCost: 19456, // 19 MiB - OWASP recommended minimum for argon2id
        timeCost: 2,
        parallelism: 1,
      });
    }
    if (this.bcrypt) return this.bcrypt.hash(plain, 12);
    throw new Error('No password hashing backend is available. Install argon2 or bcrypt.');
  }

  async verify(hash: string, plain: string): Promise<boolean> {
    await this.backends();
    try {
      if (hash.startsWith('$argon2') && this.argon2) return await this.argon2.verify(hash, plain);
      if (hash.startsWith('$2') && this.bcrypt) return await this.bcrypt.compare(plain, hash);
      if (this.argon2) {
        // Unknown prefix - fail closed rather than throwing into the request.
        return false;
      }
      return false;
    } catch {
      return false;
    }
  }

  /** True when the stored hash uses weaker parameters than current policy. */
  needsRehash(hash: string): boolean {
    if (hash.startsWith('$2') && this.argon2) return true; // upgrade bcrypt -> argon2id
    return false;
  }
}
