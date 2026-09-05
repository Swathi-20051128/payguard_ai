import multer from "multer";
import { env } from "../config/env";
import { AppError } from "./errorHandler";

const ALLOWED_MIME_TYPES = new Set([
  "text/csv",
  "application/vnd.ms-excel", // some browsers send this for .csv
  "application/json",
  "text/plain", // some browsers/OSes send this for .csv too
]);

const ALLOWED_EXTENSIONS = /\.(csv|json)$/i;

/**
 * In-memory storage — files are small enough (bounded by
 * MAX_UPLOAD_SIZE_MB) that streaming to disk first isn't necessary,
 * and keeping this stateless avoids managing temp-file cleanup.
 */
export const uploadMiddleware = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: env.MAX_UPLOAD_SIZE_MB * 1024 * 1024,
  },
  fileFilter: (_req, file, cb) => {
    const extOk = ALLOWED_EXTENSIONS.test(file.originalname);
    const mimeOk = ALLOWED_MIME_TYPES.has(file.mimetype);
    if (!extOk && !mimeOk) {
      return cb(new AppError("Only .csv and .json files are accepted", 415, "UNSUPPORTED_FILE_TYPE"));
    }
    cb(null, true);
  },
});
