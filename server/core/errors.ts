import type { ErrorCode } from '../../shared/contracts/index.ts';

// Errors that carry their own HTTP status. The error handler turns them into
// { error: { code, message } }. Messages are shown to the user, so keep them plain.
export class AppError extends Error {
  code: ErrorCode;
  status: number;

  constructor(code: ErrorCode, status: number, message: string) {
    super(message);
    this.name = 'AppError';
    this.code = code;
    this.status = status;
  }
}

export class ValidationError extends AppError {
  constructor(message: string) {
    super('validation', 400, message);
    this.name = 'ValidationError';
  }
}

export class ForbiddenError extends AppError {
  constructor(message: string) {
    super('forbidden', 403, message);
    this.name = 'ForbiddenError';
  }
}

export class NotFoundError extends AppError {
  constructor(message: string) {
    super('not_found', 404, message);
    this.name = 'NotFoundError';
  }
}

export class ConflictError extends AppError {
  constructor(message: string) {
    super('conflict', 409, message);
    this.name = 'ConflictError';
  }
}

export class AiUnavailableError extends AppError {
  constructor(message: string) {
    super('ai_unavailable', 503, message);
    this.name = 'AiUnavailableError';
  }
}
