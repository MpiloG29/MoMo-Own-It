export class AppError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status = 400,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = 'AppError';
  }
}

export const notFound = (what: string) => new AppError('NOT_FOUND', `${what} not found`, 404);
export const conflict = (code: string, message: string) => new AppError(code, message, 409);
export const invalid = (code: string, message: string, details?: unknown) =>
  new AppError(code, message, 422, details);
