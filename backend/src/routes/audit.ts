import { Router } from "express";
import { z } from "zod";
import { authenticate, authorize } from "../middleware/auth";
import { AuditLog } from "../models/AuditLog";
import { verifyChain } from "../services/audit/hashChain";
import { asyncHandler } from "../utils/asyncHandler";

export const auditRouter = Router();

auditRouter.use(authenticate);

const listQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  entityType: z.enum(["TRANSACTION", "ALERT", "CASE", "WATCHLIST", "USER"]).optional(),
  entityId: z.string().trim().optional(),
  action: z.string().trim().optional(),
});

/**
 * GET /api/audit-logs
 * Per the spec's permissions table: admin and analyst see the full
 * log, viewer gets a "Limited" view -- here that means the fact an
 * action happened (who, what, when) without the before/after state
 * detail or free-text reason, which can contain more sensitive
 * investigative detail.
 */
auditRouter.get(
  "/",
  asyncHandler(async (req, res) => {
    const query = listQuerySchema.parse(req.query);
    const filter: Record<string, unknown> = {};
    if (query.entityType) filter.entityType = query.entityType;
    if (query.entityId) filter.entityId = query.entityId;
    if (query.action) filter.action = query.action;

    const skip = (query.page - 1) * query.limit;
    const [items, total] = await Promise.all([
      AuditLog.find(filter)
        .sort({ sequence: -1 })
        .skip(skip)
        .limit(query.limit)
        .populate("userId", "name email role"),
      AuditLog.countDocuments(filter),
    ]);

    const isLimitedView = req.user!.role === "viewer";
    const shaped = items.map((entry) => {
      const json = entry.toJSON() as Record<string, unknown>;
      if (isLimitedView) {
        const { previousState, newState, reason, metadata, ...limited } = json;
        return limited;
      }
      return json;
    });

    res.status(200).json({
      items: shaped,
      pagination: { page: query.page, limit: query.limit, total, totalPages: Math.ceil(total / query.limit) },
    });
  })
);

/**
 * GET /api/audit-logs/verify
 * Recomputes every entry's hash from its stored data and confirms
 * the chain hasn't been tampered with -- a concrete, checkable
 * demonstration of the tamper-evident design (Feature 11), not just
 * a claim. Restricted to admin since it reads the full unredacted
 * log to do the check.
 */
auditRouter.get(
  "/verify",
  authorize("admin"),
  asyncHandler(async (_req, res) => {
    const entries = await AuditLog.find().sort({ sequence: 1 });

    const result = verifyChain(
      entries.map((e) => ({
        sequence: e.sequence,
        previousHash: e.previousHash,
        currentHash: e.currentHash,
        createdAt: e.createdAt,
        event: {
          userId: e.userId.toString(),
          action: e.action,
          entityType: e.entityType,
          entityId: e.entityId,
          previousState: e.previousState,
          newState: e.newState,
          reason: e.reason,
          metadata: e.metadata,
        },
      }))
    );

    res.status(200).json(result);
  })
);
