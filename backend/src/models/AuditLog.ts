import { Document, Schema, model, Types } from "mongoose";

export interface IAuditLog extends Document {
  userId: Types.ObjectId;
  action: string;
  entityType: "TRANSACTION" | "ALERT" | "CASE" | "WATCHLIST" | "USER";
  entityId: string;
  previousState?: Record<string, unknown>;
  newState?: Record<string, unknown>;
  reason?: string;
  metadata?: Record<string, unknown>;
  modelVersion?: string;
  ipAddress?: string;
  sequence: number;
  previousHash: string;
  currentHash: string;
  createdAt: Date;
}

const auditLogSchema = new Schema<IAuditLog>(
  {
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    action: { type: String, required: true, index: true },
    entityType: { type: String, enum: ["TRANSACTION", "ALERT", "CASE", "WATCHLIST", "USER"], required: true },
    entityId: { type: String, required: true, index: true },
    previousState: { type: Schema.Types.Mixed },
    newState: { type: Schema.Types.Mixed },
    reason: { type: String },
    metadata: { type: Schema.Types.Mixed },
    modelVersion: { type: String },
    ipAddress: { type: String },
    sequence: { type: Number, required: true },
    previousHash: { type: String, required: true },
    currentHash: { type: String, required: true },
  },
  { timestamps: { createdAt: true, updatedAt: false } }
);

auditLogSchema.index({ createdAt: -1 });
auditLogSchema.index({ sequence: -1 }, { unique: true });

auditLogSchema.set("toJSON", {
  transform: (_doc, ret) => {
    const { __v, ...rest } = ret;
    return rest;
  },
});

export const AuditLog = model<IAuditLog>("AuditLog", auditLogSchema);
