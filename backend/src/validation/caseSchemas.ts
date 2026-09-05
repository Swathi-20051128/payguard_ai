import { z } from "zod";

export const listAlertsQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  status: z.enum(["OPEN", "UNDER_REVIEW", "DISMISSED", "ESCALATED", "RESOLVED"]).optional(),
  severity: z.enum(["MEDIUM", "HIGH", "CRITICAL"]).optional(),
  merchantId: z.string().trim().optional(),
});

export const updateAlertStatusSchema = z.object({
  status: z.enum(["OPEN", "UNDER_REVIEW", "DISMISSED", "ESCALATED", "RESOLVED"]),
  reason: z.string().trim().optional(),
});

export const createCaseSchema = z.object({
  alertIds: z.array(z.string().trim().min(1)).min(1, "At least one alertId is required"),
});

export const assignCaseSchema = z.object({
  assignedTo: z.string().trim().min(1, "assignedTo (a user id) is required"),
});

export const decideCaseSchema = z.object({
  decision: z.enum(["confirmed_suspicious", "dismissed", "escalated"]),
  comment: z.string().trim().max(2000).optional(),
});

export const caseActionSchema = z.object({
  actionType: z.enum([
    "request_verification",
    "add_to_watchlist",
    "generate_report",
    "merchant_notification",
    "review_hold",
  ]),
  reason: z.string().trim().max(500).optional(),
  watchlist: z
    .object({
      entityType: z.enum(["customer", "device", "merchant", "cardToken", "ipHash"]),
      entityValue: z.string().trim().min(1),
    })
    .optional(),
});

export const listCasesQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  status: z.enum(["OPEN", "UNDER_REVIEW", "CONFIRMED_SUSPICIOUS", "DISMISSED", "ESCALATED", "RESOLVED"]).optional(),
  assignedTo: z.string().trim().optional(),
  merchantId: z.string().trim().optional(),
});
