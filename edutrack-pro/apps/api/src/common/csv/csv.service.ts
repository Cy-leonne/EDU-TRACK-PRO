import { BadRequestException, Injectable } from '@nestjs/common';
import { parse } from 'csv-parse/sync';

export interface CsvRow { row: number; values: Record<string, string> }

export interface CsvValidationError { row: number; field: string; message: string; value?: string }

/**
 * CSV parsing + validation for bulk imports (learners, teachers, guardians).
 *  * Header names are normalised (case/space/underscore insensitive).
 *  * Every row is validated with the shared Zod schemas before any write.
 *  * All-or-nothing per request: the caller runs the writes in a transaction.
 */
@Injectable()
export class CsvService {
  parse(buffer: Buffer, requiredHeaders: string[], maxRows = 2000): { rows: CsvRow[]; headers: string[] } {
    let records: Record<string, string>[];
    try {
      records = parse(buffer, {
        columns: (header: string[]) => header.map((h) => this.normaliseHeader(h)),
        skip_empty_lines: true,
        trim: true,
        bom: true,
        relax_column_count: true,
        max_record_size: 32 * 1024,
      });
    } catch (error) {
      throw new BadRequestException(`Could not read the CSV file: ${(error as Error).message}`);
    }
    if (!records.length) throw new BadRequestException('The CSV file has no data rows.');
    if (records.length > maxRows) throw new BadRequestException(`A maximum of ${maxRows} rows can be imported at once.`);

    const headers = Object.keys(records[0] ?? {});
    const missing = requiredHeaders.filter((h) => !headers.includes(this.normaliseHeader(h)));
    if (missing.length) {
      throw new BadRequestException(`The CSV is missing required column(s): ${missing.join(', ')}. Download the template for the expected format.`);
    }
    return { rows: records.map((values, index) => ({ row: index + 2, values })), headers };
  }

  normaliseHeader(header: string): string {
    return header.trim().toLowerCase().replace(/[\s-]+/g, '_');
  }

  normaliseValue(value: string | undefined): string {
    return (value ?? '').trim();
  }

  /** Maps common variants onto the canonical field name. */
  pick(values: Record<string, string>, ...candidates: string[]): string {
    for (const candidate of candidates) {
      const key = this.normaliseHeader(candidate);
      if (values[key] !== undefined && values[key] !== '') return values[key].trim();
    }
    return '';
  }

  template(headers: string[]): string {
    return `${headers.join(',')}\n`;
  }
}
