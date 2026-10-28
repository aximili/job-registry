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

// The AI server worked, but its answer didn't fit, even after a second try.
// Unlike AiUnavailableError, trying again later won't help on its own.
export class AiAnswerError extends AiUnavailableError {
  constructor(message: string) {
    super(message);
    this.name = 'AiAnswerError';
  }
}

// The AI server was there, but refused this request or didn't answer it in
// time (an HTTP error, a timeout). Often about this one request, such as an ad
// too long for the server's context, so other work can still go ahead.
export class AiRefusedError extends AiUnavailableError {
  constructor(message: string) {
    super(message);
    this.name = 'AiRefusedError';
  }
}
