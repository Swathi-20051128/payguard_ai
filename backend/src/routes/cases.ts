import { Router } from "express";
import { authenticate, authorize } from "../middleware/auth";
import { AppError } from "../middleware/errorHandler";
import { Case } from "../models/Case";
import { assignCase, createCase, decideCase, performCaseAction } from "../services/caseService";
import { asyncHandler } from "../utils/asyncHandler";
import {
  assignCaseSchema,
  caseActionSchema,
  createCaseSchema,
  decideCaseSchema,
  listCasesQuerySchema,
} from "../validation/caseSchemas";

export const casesRouter = Router();

casesRouter.use(authenticate);

/**
 * POST /api/cases
 * Opens a case from one or more OPEN alerts. Restricted to
 * admin/analyst per the spec's permissions table ("Review cases:
 * Viewer No").
 */
casesRouter.post(
  "/",
  authorize("admin", "analyst"),
  asyncHandler(async (req, res) => {
    const { alertIds } = createCaseSchema.parse(req.body);
    const created = await createCase(alertIds, { userId: req.user!.sub, ipAddress: req.ip });
    res.status(201).json({ case: created });
  })
);

casesRouter.get(
  "/",
  asyncHandler(async (req, res) => {
    const query = listCasesQuerySchema.parse(req.query);
    const filter: Record<string, unknown> = {};
    if (query.status) filter.status = query.status;
    if (query.assignedTo) filter.assignedTo = query.assignedTo;
    if (query.merchantId) filter.merchantId = query.merchantId;

    const skip = (query.page - 1) * query.limit;
    const [items, total] = await Promise.all([
      Case.find(filter)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(query.limit)
        .populate("assignedTo", "name email")
        .populate("createdBy", "name email"),
      Case.countDocuments(filter),
    ]);

    res.status(200).json({
      items,
      pagination: { page: query.page, limit: query.limit, total, totalPages: Math.ceil(total / query.limit) },
    });
  })
);

casesRouter.get(
  "/:caseId",
  asyncHandler(async (req, res) => {
    const found = await Case.findById(req.params.caseId)
      .populate("assignedTo", "name email")
      .populate("createdBy", "name email")
      .populate("decidedBy", "name email")
      .populate("alertIds");
    if (!found) throw new AppError("Case not found", 404, "CASE_NOT_FOUND");
    res.status(200).json({ case: found });
  })
);

casesRouter.patch(
  "/:caseId/assign",
  authorize("admin", "analyst"),
  asyncHandler(async (req, res) => {
    const { assignedTo } = assignCaseSchema.parse(req.body);
    const updated = await assignCase(req.params.caseId, assignedTo, { userId: req.user!.sub, ipAddress: req.ip });
    res.status(200).json({ case: updated });
  })
);

casesRouter.patch(
  "/:caseId/decision",
  authorize("admin", "analyst"),
  asyncHandler(async (req, res) => {
    const input = decideCaseSchema.parse(req.body);
    const updated = await decideCase(req.params.caseId, input, { userId: req.user!.sub, ipAddress: req.ip });
    res.status(200).json({ case: updated });
  })
);

/**
 * POST /api/cases/:caseId/actions
 * Simulated test-mode actions only (Feature 10) -- see caseService's
 * performCaseAction for the safety guarantees on every branch.
 */
casesRouter.post(
  "/:caseId/actions",
  authorize("admin", "analyst"),
  asyncHandler(async (req, res) => {
    const input = caseActionSchema.parse(req.body);
    const result = await performCaseAction(req.params.caseId, input, { userId: req.user!.sub, ipAddress: req.ip });
    res.status(200).json({ result });
  })
);
