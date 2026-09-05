import { Router } from "express";
import { authenticate, authorize } from "../middleware/auth";
import { AppError } from "../middleware/errorHandler";
import { Alert } from "../models/Alert";
import { recordAudit } from "../services/auditService";
import { asyncHandler } from "../utils/asyncHandler";
import { listAlertsQuerySchema, updateAlertStatusSchema } from "../validation/caseSchemas";

export const alertsRouter = Router();

alertsRouter.use(authenticate);

/**
 * GET /api/alerts
 * Available to all authenticated roles (including viewer, per the
 * spec's permissions table -- "Review cases: Viewer No" but viewing
 * the alert queue itself isn't a review action).
 */
alertsRouter.get(
  "/",
  asyncHandler(async (req, res) => {
    const query = listAlertsQuerySchema.parse(req.query);
    const filter: Record<string, unknown> = {};
    if (query.status) filter.status = query.status;
    if (query.severity) filter.severity = query.severity;
    if (query.merchantId) filter.merchantId = query.merchantId;

    const skip = (query.page - 1) * query.limit;
    const [items, total] = await Promise.all([
      Alert.find(filter).sort({ createdAt: -1 }).skip(skip).limit(query.limit),
      Alert.countDocuments(filter),
    ]);

    res.status(200).json({
      items,
      pagination: { page: query.page, limit: query.limit, total, totalPages: Math.ceil(total / query.limit) },
    });
  })
);

alertsRouter.get(
  "/:alertId",
  asyncHandler(async (req, res) => {
    const alert = await Alert.findById(req.params.alertId);
    if (!alert) throw new AppError("Alert not found", 404, "ALERT_NOT_FOUND");
    res.status(200).json({ alert });
  })
);

/**
 * PATCH /api/alerts/:alertId/status
 * A quick, direct status change (e.g. dismissing an obvious false
 * positive) without necessarily opening a full case. Still fully
 * audited (Feature 11: every action is auditable), just lighter
 * weight than the case decision workflow.
 */
alertsRouter.patch(
  "/:alertId/status",
  authorize("admin", "analyst"),
  asyncHandler(async (req, res) => {
    const { status, reason } = updateAlertStatusSchema.parse(req.body);

    const alert = await Alert.findById(req.params.alertId);
    if (!alert) throw new AppError("Alert not found", 404, "ALERT_NOT_FOUND");

    const previousStatus = alert.status;
    alert.status = status;
    await alert.save();

    await recordAudit({
      userId: req.user!.sub,
      action: "ALERT_STATUS_CHANGED",
      entityType: "ALERT",
      entityId: alert.id,
      previousState: { status: previousStatus },
      newState: { status },
      reason,
      ipAddress: req.ip,
    });

    res.status(200).json({ alert });
  })
);
