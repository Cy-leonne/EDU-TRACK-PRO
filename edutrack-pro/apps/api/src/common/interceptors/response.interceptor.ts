import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Observable, map } from 'rxjs';
import { RAW_RESPONSE_KEY } from '../decorators';

export interface PaginatedPayload<T> {
  items: T[];
  meta: { page: number; pageSize: number; total: number; totalPages: number; hasNext: boolean };
}

function isPaginated(value: unknown): value is PaginatedPayload<unknown> {
  return !!value && typeof value === 'object' && Array.isArray((value as PaginatedPayload<unknown>).items) && 'meta' in (value as object);
}

/** Wraps every successful response in a consistent envelope. */
@Injectable()
export class ResponseInterceptor<T> implements NestInterceptor<T, unknown> {
  constructor(private readonly reflector: Reflector = new Reflector()) {}

  intercept(context: ExecutionContext, next: CallHandler<T>): Observable<unknown> {
    // Downloads (CSV exports, file streams) opt out: their body must reach the client
    // byte-for-byte, so wrapping it would corrupt the file.
    const raw = this.reflector.getAllAndOverride<boolean>(RAW_RESPONSE_KEY, [context.getHandler(), context.getClass()]);
    if (raw) return next.handle();

    return next.handle().pipe(
      map((data) => {
        if (data === undefined || data === null) return { success: true, data: null };
        if (isPaginated(data)) return { success: true, data: data.items, meta: data.meta };
        return { success: true, data };
      }),
    );
  }
}
