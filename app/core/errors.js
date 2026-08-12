class AppError extends Error {
  constructor(code, message, status, options = {}) {
    super(message);
    this.name = "AppError";
    this.code = code;
    this.status = status;
    this.retryable = Boolean(options.retryable);
    this.expose = options.expose ?? true;
  }
}

const validation = (message) => new AppError("validation_error", message, 422);
const badRequest = (message) => new AppError("bad_request", message, 400);
const conflict = (message) => new AppError("conflict", message, 409);
const unavailable = (message = "storage is unavailable") =>
  new AppError("unavailable", message, 503, { retryable: true });

module.exports = { AppError, validation, badRequest, conflict, unavailable };
