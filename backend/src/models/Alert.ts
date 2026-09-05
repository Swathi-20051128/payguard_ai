import { Document, Schema, model, Types } from "mongoose";

export type AlertStatus = "OPEN" | "UNDER_REVIEW" | "DISMISSED" | "ESCALATED" | "RESOLVED";
export type AlertSeverity = "MEDIUM" | "HIGH" | "CRITICAL"; // LOW-risk transactions never generate an alert

export interface IAlert extends Document {
  transactionId: string;
  merchantId: string;
  customerId: string;
  riskScore: number;
  severity: AlertSeverity;
  confidence: "high" | "medium" | "low";
  reasons: string[];
  recommendedAction: string;
  estimatedExposure: number;
  status: AlertStatus;
  ruleEngineVersion: string;
  mlModelVersion: string | null;
  caseId?: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const alertSchema = new Schema<IAlert>(
  {
    transactionId: { type: String, required: true },
    merchantId: { type: String, required: true, index: true },
    customerId: { type: String, required: true, index: true },
    riskScore: { type: Number, required: true },
    severity: { type: String, enum: ["MEDIUM", "HIGH", "CRITICAL"], required: true, index: true },
    confidence: { type: String, enum: ["high", "medium", "low"], required: true },
    reasons: { type: [String], default: [] },
    recommendedAction: { type: String, required: true },
    estimatedExposure: { type: Number, default: 0 },
    status: { type: String, enum: ["OPEN", "UNDER_REVIEW", "DISMISSED", "ESCALATED", "RESOLVED"], default: "OPEN", index: true },
    ruleEngineVersion: { type: String, required: true },
    mlModelVersion: { type: String, default: null },
    caseId: { type: Schema.Types.ObjectId, ref: "Case" },
  },
  { timestamps: true }
);

// One open alert per transaction — re-analysis updates the existing
// alert in place rather than piling up duplicates for the same txn.
alertSchema.index({ transactionId: 1 }, { unique: true });
alertSchema.index({ status: 1, createdAt: -1 });

alertSchema.set("toJSON", {
  transform: (_doc, ret) => {
    const { __v, ...rest } = ret;
    return rest;
  },
});

export const Alert = model<IAlert>("Alert", alertSchema);
