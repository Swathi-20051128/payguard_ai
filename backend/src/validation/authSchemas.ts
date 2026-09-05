import { z } from "zod";
import { USER_ROLES } from "../models/User";

export const registerSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(120),
  email: z.string().trim().toLowerCase().email("Must be a valid email"),
  password: z
    .string()
    .min(8, "Password must be at least 8 characters")
    .max(128),
  // Role is optional on self-registration and defaults to "viewer" in the
  // service layer; only an authenticated admin can assign analyst/admin
  // (enforced in the admin user-management routes added alongside Phase 8).
  role: z.enum(USER_ROLES as [string, ...string[]]).optional(),
});

export const loginSchema = z.object({
  email: z.string().trim().toLowerCase().email("Must be a valid email"),
  password: z.string().min(1, "Password is required"),
});

export type RegisterInput = z.infer<typeof registerSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
