import { CanActivate, ExecutionContext, HttpException, HttpStatus, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Request } from 'express';

/**
 * Per-IP sliding-window rate limit for the credential endpoints
 * (login, refresh, password reset, first-run setup).
 *
 * Why not just the global throttler? Because schools commonly sit behind one
 * NAT address, so the limit is per endpoint AND configurable
 * (`AUTH_RATE_LIMIT_MAX` / `AUTH_RATE_LIMIT_WINDOW_MS`). Account lockout after
 * repeated failures is enforced separately in AuthService, so a shared IP cannot
 * lock a teacher out of their own account.
 *
 * The window is kept in process memory: correct for a single API instance, and
 * documented as needing a shared store (Redis) behind a load balancer.
 */
@Injectable()
export class IpRateLimitGuard implements CanActivate {
  private readonly logger = new Logger(IpRateLimitGuard.name);
  private readonly hits = new Map<string, number[]>();
  private lastSweep = Date.now();

  constructor(private readonly config: ConfigService) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request & { route?: { path?: string } }>();
    const max = Number(this.config.get('auth.rateLimitMax') ?? 20);
    const windowMs = Number(this.config.get('auth.rateLimitWindowMs') ?? 300_000);
    if (!Number.isFinite(max) || max <= 0) return true;

    const key = `${request.ip}|${request.method}|${request.route?.path ?? request.path}`;
    const now = Date.now();
    const history = (this.hits.get(key) ?? []).filter((timestamp) => now - timestamp < windowMs);

    this.sweep(now, windowMs);

    if (history.length >= max) {
      const retryAfterSeconds = Math.ceil((windowMs - (now - history[0]!)) / 1000);
      this.logger.warn(`Rate limit hit for ${request.ip} on ${request.path}`);
      throw new HttpException(
        { message: `Too many attempts. Try again in ${retryAfterSeconds} seconds.`, retryAfterSeconds },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    history.push(now);
    this.hits.set(key, history);
    return true;
  }

  /** Drops expired buckets so the map cannot grow without bound. */
  private sweep(now: number, windowMs: number): void {
    if (now - this.lastSweep < 60_000) return;
    this.lastSweep = now;
    for (const [key, timestamps] of this.hits.entries()) {
      const live = timestamps.filter((timestamp) => now - timestamp < windowMs);
      if (live.length) this.hits.set(key, live);
      else this.hits.delete(key);
    }
  }
}
