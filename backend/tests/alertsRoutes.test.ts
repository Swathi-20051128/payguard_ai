import request from "supertest";
import { createApp } from "../src/app";
import { Alert } from "../src/models/Alert";
import * as auditService from "../src/services/auditService";
import { signToken } from "../src/utils/jwt";

jest.mock("../src/models/Alert", () => ({
  Alert: {
    find: jest.fn(),
    findById: jest.fn(),
    countDocuments: jest.fn(),
  },
}));

jest.mock("../src/services/auditService", () => ({
  recordAudit: jest.fn().mockResolvedValue(undefined),
}));

const mockedAlert = Alert as unknown as { find: jest.Mock; findById: jest.Mock; countDocuments: jest.Mock };
const mockedAudit = auditService as jest.Mocked<typeof auditService>;

function tokenFor(role: "admin" | "analyst" | "viewer") {
  return signToken({ sub: "u1", role, email: `${role}@example.com` });
}

beforeEach(() => {
  jest.resetAllMocks();
});

describe("GET /api/alerts", () => {
  const app = createApp();

  it("requires authentication", async () => {
    const res = await request(app).get("/api/alerts");
    expect(res.status).toBe(401);
  });

  it("allows a viewer to list alerts", async () => {
    mockedAlert.find.mockReturnValue({
      sort: jest.fn().mockReturnThis(),
      skip: jest.fn().mockReturnThis(),
      limit: jest.fn().mockResolvedValue([]),
    });
    mockedAlert.countDocuments.mockResolvedValue(0);

    const res = await request(app).get("/api/alerts").set("Authorization", `Bearer ${tokenFor("viewer")}`);
    expect(res.status).toBe(200);
  });
});

describe("GET /api/alerts/:alertId", () => {
  const app = createApp();

  it("returns 404 for an unknown alert", async () => {
    mockedAlert.findById.mockResolvedValueOnce(null);
    const res = await request(app)
      .get("/api/alerts/does-not-exist")
      .set("Authorization", `Bearer ${tokenFor("viewer")}`);
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe("ALERT_NOT_FOUND");
  });

  it("returns the alert when found", async () => {
    mockedAlert.findById.mockResolvedValueOnce({ id: "a1", transactionId: "txn_1" });
    const res = await request(app).get("/api/alerts/a1").set("Authorization", `Bearer ${tokenFor("viewer")}`);
    expect(res.status).toBe(200);
    expect(res.body.alert.transactionId).toBe("txn_1");
  });
});

describe("PATCH /api/alerts/:alertId/status", () => {
  const app = createApp();

  it("rejects a viewer (403)", async () => {
    const res = await request(app)
      .patch("/api/alerts/a1/status")
      .set("Authorization", `Bearer ${tokenFor("viewer")}`)
      .send({ status: "DISMISSED" });
    expect(res.status).toBe(403);
  });

  it("returns 404 for an unknown alert", async () => {
    mockedAlert.findById.mockResolvedValueOnce(null);
    const res = await request(app)
      .patch("/api/alerts/a1/status")
      .set("Authorization", `Bearer ${tokenFor("analyst")}`)
      .send({ status: "DISMISSED" });
    expect(res.status).toBe(404);
  });

  it("updates status and records an audit entry", async () => {
    const alertDoc: any = { id: "a1", status: "OPEN", save: jest.fn().mockResolvedValue(undefined) };
    mockedAlert.findById.mockResolvedValueOnce(alertDoc);

    const res = await request(app)
      .patch("/api/alerts/a1/status")
      .set("Authorization", `Bearer ${tokenFor("admin")}`)
      .send({ status: "DISMISSED", reason: "false positive" });

    expect(res.status).toBe(200);
    expect(alertDoc.status).toBe("DISMISSED");
    expect(alertDoc.save).toHaveBeenCalled();
    expect(mockedAudit.recordAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "ALERT_STATUS_CHANGED",
        entityType: "ALERT",
        entityId: "a1",
        previousState: { status: "OPEN" },
        newState: { status: "DISMISSED" },
        reason: "false positive",
      })
    );
  });

  it("rejects an invalid status value", async () => {
    const res = await request(app)
      .patch("/api/alerts/a1/status")
      .set("Authorization", `Bearer ${tokenFor("admin")}`)
      .send({ status: "NOT_A_REAL_STATUS" });
    expect(res.status).toBe(422);
  });
});
