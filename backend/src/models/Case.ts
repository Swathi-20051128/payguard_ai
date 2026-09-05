import { Document, Schema, model, Types } from "mongoose";

export type CaseStatus = "OPEN" | "UNDER_REVIEW" | "CONFIRMED_SUSPICIOUS" | "DISMISSED" | "ESCALATED" | "RESOLVED";
export type ReviewerDecision = "confirmed_suspicious" | "dismissed" | "escalated";

export interface ICase extends Document {
  alertIds: Types.ObjectId[];
  transactionIds: string[];
  merchantId: string;
  riskScore: number;
  riskLevel: "MEDIUM" | "HIGH" | "CRITICAL";
  status: CaseStatus;
  assignedTo?: Types.ObjectId;
  createdBy: Types.ObjectId;
  reviewerDecision?: ReviewerDecision;
  reviewerComment?: string;
  decidedBy?: Types.ObjectId;
  decidedAt?: Date;
  recommendedAction: string;
  reviewHoldActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const caseSchema = new Schema<ICase>(
  {
    alertIds: { type: [Schema.Types.ObjectId], ref: "Alert", required: true },
    transactionIds: { type: [String], required: true },
    merchantId: { type: String, required: true, index: true },
    riskScore: { type: Number, required: true },
    riskLevel: { type: String, enum: ["MEDIUM", "HIGH", "CRITICAL"], required: true },
    status: {
      type: String,
      enum: ["OPEN", "UNDER_REVIEW", "CONFIRMED_SUSPICIOUS", "DISMISSED", "ESCALATED", "RESOLVED"],
      default: "OPEN",
      index: true,
    },
    assignedTo: { type: Schema.Types.ObjectId, ref: "User" },
    createdBy: { type: Schema.Types.ObjectId, ref: "User", required: true },
    reviewerDecision: { type: String, enum: ["confirmed_suspicious", "dismissed", "escalated"] },
    reviewerComment: { type: String },
    decidedBy: { type: Schema.Types.ObjectId, ref: "User" },
    decidedAt: { type: Date },
    recommendedAction: { type: String, required: true },
    reviewHoldActive: { type: Boolean, default: false },
  },
  { timestamps: true }
);

caseSchema.index({ status: 1, createdAt: -1 });
caseSchema.index({ assignedTo: 1, status: 1 });

caseSchema.set("toJSON", {
  transform: (_doc, ret) => {
    const { __v, ...rest } = ret;
    return rest;
  },
});

export const Case = model<ICase>("Case", caseSchema);
