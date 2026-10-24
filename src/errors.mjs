/** Only fixed application errors may cross an HTTP or MCP boundary. */
export class AppError extends Error {
  constructor(code, message, status = 400) {
    super(message);
    this.name = 'AppError';
    this.code = code;
    this.status = status;
  }
}

export function safeError(error) {
  return { error: error instanceof AppError
    ? { code: error.code, message: error.message }
    : { code: 'INTERNAL_ERROR', message: 'The operation could not be completed.' } };
}
