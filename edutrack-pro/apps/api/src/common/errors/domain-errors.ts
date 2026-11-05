import { ForbiddenException, HttpException, HttpStatus, NotFoundException, BadRequestException } from '@nestjs/common';

/** Raised when a caller asks for a record outside their school (anti-IDOR). */
export class TenantIsolationException extends NotFoundException {
  constructor(resource: string) {
    // Deliberately a 404: never confirm the existence of another school's data.
    super(`${resource} not found`);
  }
}

export class ResourceAccessDeniedException extends ForbiddenException {
  constructor(message = 'You do not have access to this resource') {
    super(message);
  }
}

export class BusinessRuleException extends BadRequestException {}

export class ConflictException extends HttpException {
  constructor(message: string, details?: unknown) {
    super({ message, details }, HttpStatus.CONFLICT);
  }
}

export class ValidationFailedException extends HttpException {
  constructor(message: string, details?: unknown) {
    super({ message, details }, HttpStatus.UNPROCESSABLE_ENTITY);
  }
}

export class NotImplementedException extends HttpException {
  constructor(message: string, details?: unknown) {
    super({ message, details }, HttpStatus.NOT_IMPLEMENTED);
  }
}
