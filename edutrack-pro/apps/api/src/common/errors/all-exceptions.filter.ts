import {
  ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus, Logger,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { randomUUID } from 'crypto';
import type { Request, Response } from 'express';

/**
 * Centralised error handling.
 *  * Never leaks stack traces, SQL, or child data to clients.
 *  * Maps Prisma errors onto meaningful HTTP responses.
 *  * Emits a requestId so a support ticket can be correlated with logs.
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger('ExceptionFilter');

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request & { requestId?: string }>();
    const requestId = request.requestId ?? randomUUID();

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let message: string | string[] = 'Something went wrong. Please try again.';
    let error = 'Internal Server Error';
    let details: unknown;

    if (exception instanceof HttpException) {
      status = exception.getStatus();
      const res = exception.getResponse();
      if (typeof res === 'string') {
        message = res;
        error = exception.name.replace(/Exception$/, '');
      } else {
        const obj = res as Record<string, unknown>;
        message = (obj.message as string | string[]) ?? exception.message;
        error = (obj.error as string) ?? exception.name.replace(/Exception$/, '');
        details = obj.details;
      }
    } else if (exception instanceof Prisma.PrismaClientKnownRequestError) {
      switch (exception.code) {
        case 'P2002': {
          status = HttpStatus.CONFLICT;
          const target = (exception.meta?.target as string[] | string | undefined) ?? 'value';
          error = 'Conflict';
          message = `A record with this ${Array.isArray(target) ? target.join(', ') : target} already exists.`;
          break;
        }
        case 'P2003':
          status = HttpStatus.BAD_REQUEST;
          error = 'InvalidReference';
          message = 'The operation references a record that does not exist.';
          break;
        case 'P2025':
          status = HttpStatus.NOT_FOUND;
          error = 'NotFound';
          message = 'The requested record was not found.';
          break;
        default:
          status = HttpStatus.BAD_REQUEST;
          error = 'DatabaseError';
          message = 'The request could not be completed because of a data conflict.';
      }
    } else if (exception instanceof Prisma.PrismaClientValidationError) {
      status = HttpStatus.BAD_REQUEST;
      error = 'ValidationError';
      message = 'Invalid data supplied.';
    }

    if (status >= 500) {
      // Full detail stays in server logs only (and must never contain passwords/tokens).
      this.logger.error(
        `[${requestId}] ${request.method} ${request.url} -> ${status}: ${(exception as Error)?.message}`,
        (exception as Error)?.stack,
      );
    } else {
      this.logger.warn(`[${requestId}] ${request.method} ${request.url} -> ${status}: ${JSON.stringify(message)}`);
    }

    response.status(status).json({
      success: false,
      statusCode: status,
      error,
      message,
      details,
      requestId,
      timestamp: new Date().toISOString(),
      path: request.url,
    });
  }
}
