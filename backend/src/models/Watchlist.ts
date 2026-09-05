import { Document, Schema, model, Types } from "mongoose";

export type WatchlistEntityType = "customer" | "device" | "merchant" | "cardToken" | "ipHash";

export interface IWatchlist extends Document {
  entityType: WatchlistEntityType;
  entityValue: string;
  reason: string;
  addedBy: Types.ObjectId;
  caseId?: Types.ObjectId;
  active: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const watchlistSchema = new Schema<IWatchlist>(
  {
    entityType: { type: String, enum: ["customer", "device", "merchant", "cardToken", "ipHash"], required: true },
    entityValue: { type: String, required: true },
    reason: { type: String, required: true },
    addedBy: { type: Schema.Types.ObjectId, ref: "User", required: true },
    caseId: { type: Schema.Types.ObjectId, ref: "Case" },
    active: { type: Boolean, default: true },
  },
  { timestamps: true }
);

watchlistSchema.index({ entityType: 1, entityValue: 1 });

watchlistSchema.set("toJSON", {
  transform: (_doc, ret) => {
    const { __v, ...rest } = ret;
    return rest;
  },
});

export const Watchlist = model<IWatchlist>("Watchlist", watchlistSchema);
