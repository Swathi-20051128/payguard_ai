import { Router } from "express";
import { authenticate, authorize } from "../middleware/auth";
import { AppError } from "../middleware/errorHandler";
import { uploadMiddleware } from "../middleware/upload";
import { Transaction } from "../models/Transaction";
import { Upload } from "../models/Upload";
import { generateDataset } from "../services/generator";
import { ingestCsvBuffer, ingestJsonArray } from "../services/csvIngestService";
import { newIngestResult } from "../services/transactionIngestService";
import { asyncHandler } from "../utils/asyncHandler";
import {
  generateSampleSchema,
  listTransactionsQuerySchema,
} from "../validation/transactionSchemas";

export const transactionsRouter = Router();

// All transaction routes require authentication. Upload/generate are
// restricted to admin+analyst (per the spec's permissions table);
// read routes are open to all authenticated roles including viewer.
transactionsRouter.use(authenticate);

/**
 * POST /api/transactions/upload
 * multipart/form-data with a single "file" field (.csv or .json).
 */
transactionsRouter.post(
  "/upload",
  authorize("admin", "analyst"),
  uploadMiddleware.single("file"),
  asyncHandler(async (req, res) => {
    if (!req.file) {
      throw new AppError("No file was uploaded. Attach a file under the 'file' field.", 400, "NO_FILE");
    }

    const isJson = /\.json$/i.test(req.file.originalname) || req.file.mimetype === "application/json";
    const source = isJson ? "json" : "csv";

    const upload = await Upload.create({
      filename: req.file.originalname,
      source,
      status: "processing",
      uploadedBy: req.user!.sub,
    });

    const result = newIngestResult();

    try {
      if (isJson) {
        const parsed = JSON.parse(req.file.buffer.toString("utf-8"));
        const rows = Array.isArray(parsed) ? parsed : [parsed];
        await ingestJsonArray(rows, upload.id, result);
      } else {
        await ingestCsvBuffer(req.file.buffer, upload.id, result);
      }

      upload.status = "completed";
    } catch (err) {
      upload.status = "failed";
      result.sampleErrors.push({
        row: -1,
        message: err instanceof Error ? err.message : "Unknown error while parsing the file",
      });
    }

    upload.totalRows = result.totalRows;
    upload.insertedCount = result.insertedCount;
    upload.duplicateCount = result.duplicateCount;
    upload.invalidCount = result.invalidCount;
    upload.sampleErrors = result.sampleErrors;
    upload.completedAt = new Date();
    await upload.save();

    res.status(201).json({ upload });
  })
);

/**
 * POST /api/transactions/generate-sample
 * Built-in synthetic data generator (Feature 3) — lets an evaluator
 * populate a realistic dataset with known fraud patterns immediately,
 * with no external file needed.
 */
transactionsRouter.post(
  "/generate-sample",
  authorize("admin", "analyst"),
  asyncHandler(async (req, res) => {
    const input = generateSampleSchema.parse(req.body ?? {});

    const upload = await Upload.create({
      filename: `generated-${input.transactionCount}-transactions`,
      source: "generated",
      status: "processing",
      uploadedBy: req.user!.sub,
    });

    const { rows, scenarioCounts } = generateDataset(input);
    const result = newIngestResult();

    // Generated rows already match the schema shape, but we still run
    // them through the same ingestRows() validation/dedup path as any
    // other upload — one code path, no special-cased trust.
    await ingestJsonArray(
      rows.map((r) => ({ ...r, timestamp: r.timestamp.toISOString() })),
      upload.id,
      result
    );

    upload.status = "completed";
    upload.totalRows = result.totalRows;
    upload.insertedCount = result.insertedCount;
    upload.duplicateCount = result.duplicateCount;
    upload.invalidCount = result.invalidCount;
    upload.sampleErrors = result.sampleErrors;
    upload.completedAt = new Date();
    await upload.save();

    res.status(201).json({ upload, scenarioCounts });
  })
);

/**
 * GET /api/transactions
 * Paginated, filterable list. Available to all authenticated roles.
 */
transactionsRouter.get(
  "/",
  asyncHandler(async (req, res) => {
    const query = listTransactionsQuerySchema.parse(req.query);
    const filter: Record<string, unknown> = {};

    if (query.merchantId) filter.merchantId = query.merchantId;
    if (query.customerId) filter.customerId = query.customerId;
    if (query.deviceId) filter.deviceId = query.deviceId;
    if (query.status) filter.status = query.status;
    if (query.riskLevel) filter.riskLevel = query.riskLevel;
    if (query.from || query.to) {
      filter.timestamp = {
        ...(query.from ? { $gte: query.from } : {}),
        ...(query.to ? { $lte: query.to } : {}),
      };
    }

    const skip = (query.page - 1) * query.limit;
    const [items, total] = await Promise.all([
      Transaction.find(filter).sort({ timestamp: -1 }).skip(skip).limit(query.limit),
      Transaction.countDocuments(filter),
    ]);

    res.status(200).json({
      items,
      pagination: { page: query.page, limit: query.limit, total, totalPages: Math.ceil(total / query.limit) },
    });
  })
);

/**
 * GET /api/transactions/uploads
 * Upload history. Placed before the /:transactionId route so it
 * doesn't get swallowed as a transactionId lookup.
 */
transactionsRouter.get(
  "/uploads",
  asyncHandler(async (_req, res) => {
    const uploads = await Upload.find().sort({ createdAt: -1 }).limit(50).populate("uploadedBy", "name email role");
    res.status(200).json({ uploads });
  })
);

/**
 * GET /api/transactions/:transactionId
 */
transactionsRouter.get(
  "/:transactionId",
  asyncHandler(async (req, res) => {
    const txn = await Transaction.findOne({ transactionId: req.params.transactionId });
    if (!txn) {
      throw new AppError("Transaction not found", 404, "TRANSACTION_NOT_FOUND");
    }
    res.status(200).json({ transaction: txn });
  })
);
