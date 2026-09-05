import { z } from "zod";

/**
 * z.coerce.boolean() is a footgun for CSV data: any non-empty string
 * (including the literal text "false") coerces to `true`. This helper
 * interprets common textual/boolean/numeric representations correctly.
 */
const csvBoolean = z.preprocess((val) => {
  if (typeof val === "boolean") return val;
  if (typeof val === "number") return val !== 0;
  if (typeof val === "string") {
    const normalized = val.trim().toLowerCase();
    if (["true", "1", "yes", "y"].includes(normalized)) return true;
    if (["false", "0", "no", "n", ""].includes(normalized)) return false;
  }
  return val;
}, z.boolean());

/**
 * Case-insensitive enum: the supplied synthetic datasets use
 * uppercase paymentMethod values ("CARD", "UPI"), while hand-written
 * test fixtures and the sample generator use lowercase. Normalizing
 * here means both import cleanly instead of the real dataset
 * silently failing validation on a casing mismatch.
 */
function caseInsensitiveEnum<T extends [string, ...string[]]>(values: T) {
  return z.preprocess((val) => (typeof val === "string" ? val.toLowerCase() : val), z.enum(values));
}

/**
 * Validates + coerces one incoming transaction record. Used for both
 * CSV rows (everything arrives as a string) and JSON event uploads
 * (already typed) — z.coerce handles both uniformly.
 *
 * Never accepts real card numbers, CVVs, or bank credentials: cardToken
 * is validated as a synthetic token shape, not a card-number shape.
 */
export const transactionRowSchema = z.object({
  transactionId: z.string().trim().min(1, "transactionId is required"),
  orderId: z.string().trim().min(1, "orderId is required"),
  merchantId: z.string().trim().min(1, "merchantId is required"),
  customerId: z.string().trim().min(1, "customerId is required"),
  amount: z.coerce.number().finite().min(0, "amount must be >= 0"),
  currency: z.string().trim().default("INR"),
  status: caseInsensitiveEnum(["success", "failed", "pending", "refunded"]),
  paymentMethod: caseInsensitiveEnum(["card", "upi", "netbanking", "wallet"]),
  cardToken: z
    .string()
    .trim()
    .optional()
    .refine((v) => !v || !/^\d{12,19}$/.test(v), {
      message: "cardToken must not look like a real card number — use a synthetic token (e.g. card_token_104)",
    }),
  deviceId: z.string().trim().min(1, "deviceId is required"),
  ipHash: z.string().trim().min(1, "ipHash is required"),
  country: z.string().trim().min(1, "country is required"),
  city: z.string().trim().min(1, "city is required"),
  timestamp: z.coerce.date({ errorMap: () => ({ message: "timestamp must be a valid date" }) }),
  refundAmount: z.coerce.number().finite().min(0).default(0),
  chargebackFlag: csvBoolean.default(false),
  failureReason: z
    .string()
    .trim()
    .optional()
    .transform((v) => (v === "" ? undefined : v)),

  // Evaluation-only, optional on input — present in the supplied
  // synthetic datasets, absent on real-world-shaped uploads.
  groundTruthRisk: z.coerce.number().optional(),
  fraudScenario: z
    .string()
    .trim()
    .optional()
    .transform((v) => (v === "" ? undefined : v)),
});

export type TransactionRowInput = z.infer<typeof transactionRowSchema>;

export const generateSampleSchema = z.object({
  transactionCount: z.coerce.number().int().min(100).max(50_000).default(10_000),
  customerCount: z.coerce.number().int().min(10).max(5_000).default(500),
  merchantCount: z.coerce.number().int().min(2).max(500).default(50),
  deviceCount: z.coerce.number().int().min(10).max(10_000).default(1_000),
  cardTokenCount: z.coerce.number().int().min(10).max(10_000).default(1_500),
  ipHashCount: z.coerce.number().int().min(10).max(10_000).default(1_000),
  suspiciousRate: z.coerce.number().min(0.01).max(0.5).default(0.08),
});

export type GenerateSampleInput = z.infer<typeof generateSampleSchema>;

export const listTransactionsQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  merchantId: z.string().trim().optional(),
  customerId: z.string().trim().optional(),
  deviceId: z.string().trim().optional(),
  status: caseInsensitiveEnum(["success", "failed", "pending", "refunded"]).optional(),
  riskLevel: z.enum(["LOW", "MEDIUM", "HIGH", "CRITICAL"]).optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
});

export type ListTransactionsQuery = z.infer<typeof listTransactionsQuerySchema>;

export const analyzeTransactionSchema = z.object({
  transactionId: z.string().trim().min(1, "transactionId is required"),
});

export const analyzeBatchSchema = z
  .object({
    uploadId: z.string().trim().optional(),
    transactionIds: z.array(z.string().trim().min(1)).max(5000).optional(),
    reanalyzeAll: z.boolean().optional().default(false),
  })
  .refine((v) => v.uploadId || (v.transactionIds && v.transactionIds.length > 0) || v.reanalyzeAll, {
    message: "Provide one of: uploadId, transactionIds, or reanalyzeAll",
  });

export type AnalyzeBatchInput = z.infer<typeof analyzeBatchSchema>;
