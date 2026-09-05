import request from "supertest";
import { createApp } from "../src/app";
import { AuditLog } from "../src/models/AuditLog";
import { signToken } from "../src/utils/jwt";

jest.mock("../src/models/AuditLog", () => ({
  AuditLog: {
    find: jest.fn(),
    countDocuments: jest.fn(),
  },
}));

const mockedAuditLog = AuditLog as unknown as { find: jest.Mock; countDocuments: jest.Mock };

function tokenFor(role: "admin" | "analyst" | "viewer") {
  return signToken({ sub: "u1", role, email: `${role}@example.com` });
}

beforeEach(() => {
  jest.resetAllMocks();
});

function mockEntries(entries: Record<string, unknown>[]) {
  const docs = entries.map((e) => ({ toJSON: () => e }));
  mockedAuditLog.find.mockReturnValue({
    sort: jest.fn().mockReturnThis(),
    skip: jest.fn().mockReturnThis(),
    limit: jest.fn().mockReturnThis(),
    populate: jest.fn().mockResolvedValue(docs),
  });
}

describe("GET /api/audit-logs", () => {
  const app = createApp();

  it("requires authentication", async () => {
    const res = await request(app).get("/api/audit-logs");
    expect(res.status).toBe(401);
  });

  it("returns full detail for an analyst", async () => {
    mockEntries([
      {
        action: "CASE_CREATED",
        entityType: "CASE",
        entityId: "case1",
        previousState: { status: "OPEN" },
        newState: { status: "UNDER_REVIEW" },
        reason: "some reason",
        metadata: { foo: "bar" },
      },
    ]);
    mockedAuditLog.countDocuments.mockResolvedValue(1);

    const res = await request(app).get("/api/audit-logs").set("Authorization", `Bearer ${tokenFor("analyst")}`);

    expect(res.status).toBe(200);
    expect(res.body.items[0]).toHaveProperty("previousState");
    expect(res.body.items[0]).toHaveProperty("reason");
  });

  it("returns a limited view for a viewer (no state/reason/metadata)", async () => {
    mockEntries([
      {
        action: "CASE_CREATED",
        entityType: "CASE",
        entityId: "case1",
        previousState: { status: "OPEN" },
        newState: { status: "UNDER_REVIEW" },
        reason: "some reason",
        metadata: { foo: "bar" },
      },
    ]);
    mockedAuditLog.countDocuments.mockResolvedValue(1);

    const res = await request(app).get("/api/audit-logs").set("Authorization", `Bearer ${tokenFor("viewer")}`);

    expect(res.status).toBe(200);
    expect(res.body.items[0]).not.toHaveProperty("previousState");
    expect(res.body.items[0]).not.toHaveProperty("newState");
    expect(res.body.items[0]).not.toHaveProperty("reason");
    expect(res.body.items[0]).not.toHaveProperty("metadata");
    expect(res.body.items[0]).toHaveProperty("action", "CASE_CREATED");
  });
});

describe("GET /api/audit-logs/verify", () => {
  const app = createApp();

  it("rejects a non-admin (403)", async () => {
    const res = await request(app)
      .get("/api/audit-logs/verify")
      .set("Authorization", `Bearer ${tokenFor("analyst")}`);
    expect(res.status).toBe(403);
  });

  it("returns valid=true for an empty log", async () => {
    mockedAuditLog.find.mockReturnValue({ sort: jest.fn().mockResolvedValue([]) });
    const res = await request(app).get("/api/audit-logs/verify").set("Authorization", `Bearer ${tokenFor("admin")}`);
    expect(res.status).toBe(200);
    expect(res.body.valid).toBe(true);
    expect(res.body.totalEntries).toBe(0);
  });
});
