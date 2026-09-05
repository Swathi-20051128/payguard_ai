import { Document, Schema, model } from "mongoose";

export type UserRole = "admin" | "analyst" | "viewer";

export const USER_ROLES: UserRole[] = ["admin", "analyst", "viewer"];

export interface IUser extends Document {
  name: string;
  email: string;
  passwordHash: string;
  role: UserRole;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const userSchema = new Schema<IUser>(
  {
    name: { type: String, required: true, trim: true, maxlength: 120 },
    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
      index: true,
    },
    // Never store or return plaintext passwords — only the bcrypt hash.
    passwordHash: { type: String, required: true, select: false },
    role: { type: String, enum: USER_ROLES, default: "viewer", required: true },
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true }
);

// toJSON transform strips internal/sensitive fields from any response
// that serializes a user document directly.
userSchema.set("toJSON", {
  transform: (_doc, ret) => {
    const { passwordHash, __v, ...rest } = ret;
    return rest;
  },
});

export const User = model<IUser>("User", userSchema);
