import { ArgumentMetadata, BadRequestException, Injectable, PipeTransform } from '@nestjs/common';
import type { ZodSchema } from 'zod';

export interface ZodPipeOptions { stripUnknown?: boolean }

/**
 * Validates and transforms request payloads with the shared Zod schemas.
 * Query parameters arrive as strings, so schemas use z.coerce for numbers.
 */
@Injectable()
export class ZodValidationPipe implements PipeTransform {
  constructor(private readonly schema: ZodSchema, private readonly options: ZodPipeOptions = {}) {}

  transform(value: unknown, _metadata: ArgumentMetadata): unknown {
    const result = this.schema.safeParse(value);
    if (!result.success) {
      const details = result.error.issues.map((issue) => ({
        field: issue.path.join('.') || '(root)',
        message: issue.message,
        code: issue.code,
      }));
      throw new BadRequestException({
        message: details.map((d) => (d.field === '(root)' ? d.message : `${d.field}: ${d.message}`)),
        details,
      });
    }
    return result.data;
  }
}

/** Convenience factory used by controllers: @Body(zodPipe(schema)) */
export function zodPipe(schema: ZodSchema, options?: ZodPipeOptions): ZodValidationPipe {
  return new ZodValidationPipe(schema, options);
}
