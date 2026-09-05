import { Document, Schema, model, Types } from "mongoose";

export type UploadSource = "csv" | "json" | "generated";
export type UploadStatus = "processing" | "completed" | "failed";

export interface IUpload extends Document {
  filename: string;
  source: UploadSource;
  status: UploadStatus;
  uploadedBy: Types.ObjectId;
  totalRows: number;
  insertedCount: number;
  duplicateCount: number;
  invalidCount: number;
  // Small sample of validation failures for the analyst/admin to see
  // what went wrong, capped so a bad file doesn't bloat this document.
  sampleErrors: { row: number; message: string }[];
  startedAt: Date;
  completedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const uploadSchema = new Schema<IUpload>(
  {
    filename: { type: String, required: true },
    source: { type: String, enum: ["csv", "json", "generated"], required: true },
    status: { type: String, enum: ["processing", "completed", "failed"], default: "processing" },
    uploadedBy: { type: Schema.Types.ObjectId, ref: "User", required: true },
    totalRows: { type: Number, default: 0 },
    insertedCount: { type: Number, default: 0 },
    duplicateCount: { type: Number, default: 0 },
    invalidCount: { type: Number, default: 0 },
    sampleErrors: {
      type: [{ row: Number, message: String }],
      default: [],
    },
    startedAt: { type: Date, default: Date.now },
    completedAt: { type: Date },
  },
  { timestamps: true }
);

uploadSchema.index({ createdAt: -1 });

uploadSchema.set("toJSON", {
  transform: (_doc, ret) => {
    const { __v, ...rest } = ret;
    return rest;
  },
});

export const Upload = model<IUpload>("Upload", uploadSchema);
