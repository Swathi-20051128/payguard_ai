import { Document, Schema, model } from "mongoose";

export type TransactionStatus = "success" | "failed" | "pending" | "refunded";
export type PaymentMethod = "card" | "upi" | "netbanking" | "wallet";

export interface ITransaction extends Document {
  transactionId: string;
  orderId: string;
  merchantId: string;
  customerId: string;
  amount: number;
  currency: string;
  status: TransactionStatus;
  paymentMethod: PaymentMethod;
  cardToken?: string;
  deviceId: string;
  ipHash: string;
  country: string;
  city: string;
  timestamp: Date;
  refundAmount: number;
  chargebackFlag: boolean;
  failureReason?: string;

  // --- Evaluation-only fields ---
  // These describe the synthetic ground truth used to score the rule
  // engine / ML model in Phase 5/8. They are NEVER returned by any
  // analyst-facing API (stripped in toJSON below) and never rendered
  // in the UI — showing them would hand the analyst the answer and
  // defeat the point of testing detection.
  groundTruthRisk?: number;
  fraudScenario?: string;

  // --- Ingestion metadata ---
  uploadId?: string;
  ingestedAt: Date;

  // --- Risk fields populated by the rule engine (Phase 4) and ML
  // service (Phase 5), combined into a final assessment (Phase 6) ---
  riskScore?: number; // final blended score, 0-100
  riskLevel?: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
  riskReasons?: string[]; // merged rule + ML explanations
  confidence?: "high" | "medium" | "low";
  estimatedExposure?: number; // simulated — see spec's requirement that this is never presented as a real figure

  ruleScore?: number; // rule-engine-only score, before blending with ML
  ruleEngineVersion?: string;

  mlAnomalyScore?: number | null; // Isolation Forest, unsupervised
  mlSupervisedProbability?: number | null; // Random Forest, supervised
  mlModelVersion?: string | null;
  mlUsedFallback?: boolean; // true = ML was unavailable; riskScore is rules-only

  analyzedAt?: Date;

  createdAt: Date;
  updatedAt: Date;
}

const transactionSchema = new Schema<ITransaction>(
  {
    transactionId: { type: String, required: true, unique: true, index: true },
    orderId: { type: String, required: true },
    merchantId: { type: String, required: true, index: true },
    customerId: { type: String, required: true, index: true },
    amount: { type: Number, required: true, min: 0 },
    currency: { type: String, required: true, default: "INR" },
    status: { type: String, enum: ["success", "failed", "pending", "refunded"], required: true },
    paymentMethod: { type: String, enum: ["card", "upi", "netbanking", "wallet"], required: true },
    cardToken: { type: String },
    deviceId: { type: String, required: true, index: true },
    ipHash: { type: String, required: true },
    country: { type: String, required: true },
    city: { type: String, required: true },
    timestamp: { type: Date, required: true, index: true },
    refundAmount: { type: Number, default: 0, min: 0 },
    chargebackFlag: { type: Boolean, default: false },
    failureReason: { type: String },

    groundTruthRisk: { type: Number, select: false },
    fraudScenario: { type: String, select: false },

    uploadId: { type: String, index: true },
    ingestedAt: { type: Date, default: Date.now },

    riskScore: { type: Number },
    riskLevel: { type: String, enum: ["LOW", "MEDIUM", "HIGH", "CRITICAL"], index: true },
    riskReasons: { type: [String], default: undefined },
    confidence: { type: String, enum: ["high", "medium", "low"] },
    estimatedExposure: { type: Number },

    ruleScore: { type: Number },
    ruleEngineVersion: { type: String },

    mlAnomalyScore: { type: Number, default: null },
    mlSupervisedProbability: { type: Number, default: null },
    mlModelVersion: { type: String, default: null },
    mlUsedFallback: { type: Boolean },

    analyzedAt: { type: Date },
  },
  { timestamps: true }
);

// Compound indexes supporting the velocity/spike rules added in Phase 4
// (e.g. "attempts from this device in the last 5 minutes").
transactionSchema.index({ deviceId: 1, timestamp: -1 });
transactionSchema.index({ merchantId: 1, timestamp: -1 });
transactionSchema.index({ customerId: 1, timestamp: -1 });
transactionSchema.index({ riskLevel: 1, timestamp: -1 });
// Supports the coordinated-activity rule's $or:[{deviceId},{ipHash}]
// lookup (Phase 4) — deviceId+timestamp already covers the device
// half, this covers the IP half.
transactionSchema.index({ ipHash: 1, timestamp: -1 });
// Supports the duplicate-payment rule's per-orderId lookup (Phase 4).
transactionSchema.index({ orderId: 1, timestamp: -1 });

transactionSchema.set("toJSON", {
  transform: (_doc, ret) => {
    const { groundTruthRisk, fraudScenario, __v, ...rest } = ret;
    return rest;
  },
});

export const Transaction = model<ITransaction>("Transaction", transactionSchema);
