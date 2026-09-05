import { NextFunction, Request, Response } from "express";
import { MulterError } from "multer";
import { ZodError } from "zod";
import { logger } from "../config/logger";

/**
 * Thrown by route handlers / services for expected, user-facing
 * failures (validation, auth, not-found, etc). Anything that isn't
 * an AppError is treated as an unexpected 500 and logged loudly.
 */
export class AppError extends Error {
  statusCode: number;
  code: string;

  constructor(message: string, statusCode = 400, code = "BAD_REQUEST") {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
    Object.setPrototypeOf(this, AppError.prototype);
  }
}

export function notFoundHandler(req: Request, res: Response) {
  res.status(404).json({
    error: { code: "NOT_FOUND", message: `Route not found: ${req.method} ${req.originalUrl}` },
  });
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function errorHandler(err: unknown, req: Request, res: Response, _next: NextFunction) {
  if (err instanceof ZodError) {
    return res.status(422).json({
      error: {
        code: "VALIDATION_ERROR",
        message: "Request validation failed",
        details: err.flatten(),
      },
    });
  }

  if (err instanceof MulterError) {
    const status = err.code === "LIMIT_FILE_SIZE" ? 413 : 400;
    return res.status(status).json({
      error: { code: `UPLOAD_${err.code}`, message: describeMulterError(err) },
    });
  }

  if (err instanceof AppError) {
    if (err.statusCode >= 500) {
      logger.error({ err }, "AppError (5xx)");
    }
    return res.status(err.statusCode).json({
      error: { code: err.code, message: err.message },
    });
  }

  // Mongoose throws one of these when a query runs while disconnected:
  // - with bufferCommands=false (our config): "before initial connection is complete"
  // - if buffering timeout is ever hit instead: "buffering timed out"
  // Surface both as a clear, retryable 503 rather than a generic 500.
  if (err instanceof Error && /before initial connection is complete|buffering timed out|not connected/i.test(err.message)) {
    logger.error({ err }, "Database unavailable");
    return res.status(503).json({
      error: { code: "DATABASE_UNAVAILABLE", message: "The database is temporarily unavailable. Please try again shortly." },
    });
  }

  logger.error({ err }, "Unhandled error");
  return res.status(500).json({
    error: { code: "INTERNAL_ERROR", message: "Something went wrong. Please try again." },
  });
}

function describeMulterError(err: MulterError): string {
  switch (err.code) {
    case "LIMIT_FILE_SIZE":
      return "The uploaded file is too large.";
    case "LIMIT_UNEXPECTED_FILE":
      return "Unexpected file field in the upload request.";
    default:
      return err.message || "File upload failed.";
  }
}
