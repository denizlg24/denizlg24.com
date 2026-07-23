export abstract class CloudCoreError extends Error {
  abstract readonly status: 400 | 401 | 403 | 404 | 409;

  constructor(
    message: string,
    readonly code: string,
  ) {
    super(message);
    this.name = new.target.name;
  }
}

export class AuthenticationError extends CloudCoreError {
  readonly status = 401;

  constructor(message: string, code = "UNAUTHORIZED") {
    super(message, code);
  }
}

export class NotFoundError extends CloudCoreError {
  readonly status = 404;

  constructor(message: string, code = "NOT_FOUND") {
    super(message, code);
  }
}

export class ConflictError extends CloudCoreError {
  readonly status = 409;

  constructor(message: string, code = "CONFLICT") {
    super(message, code);
  }
}

export class ValidationError extends CloudCoreError {
  readonly status = 400;

  constructor(message: string, code = "VALIDATION_ERROR") {
    super(message, code);
  }
}

export class ForbiddenError extends CloudCoreError {
  readonly status = 403;

  constructor(message: string, code = "FORBIDDEN") {
    super(message, code);
  }
}
