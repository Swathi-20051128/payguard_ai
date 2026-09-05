import request from "supertest";
import { createApp } from "../src/app";
import { Transaction } from "../src/models/Transaction";
import * as riskAnalysisService from "../src/services/riskAnalysisService";
import { signToken } from "../src/utils/jwt";

jest.mock("../src/models/Transaction", () => ({
  Transaction: {
    findOne: jest.fn(),
    aggregate: jest.fn(),
    countDocuments: jest.fn(),
  },
}));

jest.mock("../src/services/riskAnalysisService", () => ({
  ...jest.requireActual("../src/services/riskAnalysisService"),
  analyzeTransaction: jest.fn(),
  analyzeBatch: jest.fn(),
}));

const mockedTxn = Transaction as unknown as { findOne: jest.Mock; aggregate: jest.Mock; countDocuments: jest.Mock };
const mockedService = riskAnalysisService as jest.Mocked<typeof riskAnalysisService>;

function tokenFor(role: "admin" | "analyst" | "viewer") {
  return signToken({ sub: "u1", role, email: `${role}@example.com` });
}

beforeEach(() => {
  jest.resetAllMocks();
});

describe("Risk routes — auth gating", () => {
  const app = createApp();

  it("rejects unauthenticated analyze-transaction", async () => {
    const res = await request(app).post("/api/risk/analyze-transaction").send({ transactionId: "txn_1" });
    expect(res.status).toBe(401);
  });

  it("rejects a viewer's attempt to analyze a transaction (403)", async () => {
    const res = await request(app)
      .post("/api/risk/analyze-transaction")
      .set("Authorization", `Bearer ${tokenFor("viewer")}`)
      .send({ transactionId: "txn_1" });
    expect(res.status).toBe(403);
  });

  it("allows a viewer to read the risk summary", async () => {
    mockedTxn.aggregate.mockResolvedValue([]);
    mockedTxn.countDocuments.mockResolvedValue(0);
    const res = await request(app).get("/api/risk/summary").set("Authorization", `Bearer ${tokenFor("viewer")}`);
    expect(res.status).toBe(200);
  });
});

describe("POST /api/risk/analyze-transaction", () => {
  const app = createApp();

  it("returns 404 for an unknown transaction", async () => {
    mockedTxn.findOne.mockResolvedValueOnce(null);
    const res = await request(app)
      .post("/api/risk/analyze-transaction")
      .set("Authorization", `Bearer ${tokenFor("analyst")}`)
      .send({ transactionId: "does-not-exist" });
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe("TRANSACTION_NOT_FOUND");
  });

  it("returns 422 when transactionId is missing", async () => {
    const res = await request(app)
      .post("/api/risk/analyze-transaction")
      .set("Authorization", `Bearer ${tokenFor("analyst")}`)
      .send({});
    expect(res.status).toBe(422);
  });

  it("scores the transaction and returns the result", async () => {
    mockedTxn.findOne.mockResolvedValueOnce({ transactionId: "txn_1" });
    mockedService.analyzeTransaction.mockResolvedValueOnce({
      transactionId: "txn_1",
      riskScore: 72,
      riskLevel: "HIGH",
      reasons: ["some reason"],
      confidence: "high",
      estimatedExposure: 5000,
      mlUsedFallback: false,
    });

    const res = await request(app)
      .post("/api/risk/analyze-transaction")
      .set("Authorization", `Bearer ${tokenFor("admin")}`)
      .send({ transactionId: "txn_1" });

    expect(res.status).toBe(200);
    expect(res.body.result.riskLevel).toBe("HIGH");
    expect(mockedService.analyzeTransaction).toHaveBeenCalledWith({ transactionId: "txn_1" });
  });
});

describe("POST /api/risk/analyze-batch", () => {
  const app = createApp();

  it("rejects a request with none of uploadId/transactionIds/reanalyzeAll", async () => {
    const res = await request(app)
      .post("/api/risk/analyze-batch")
      .set("Authorization", `Bearer ${tokenFor("analyst")}`)
      .send({});
    expect(res.status).toBe(422);
  });

  it("scores by uploadId and passes the right filter", async () => {
    mockedService.analyzeBatch.mockResolvedValueOnce({
      totalAnalyzed: 10,
      byRiskLevel: { LOW: 8, MEDIUM: 1, HIGH: 1, CRITICAL: 0 },
      failedTransactionIds: [],
      mlAvailable: true,
    });

    const res = await request(app)
      .post("/api/risk/analyze-batch")
      .set("Authorization", `Bearer ${tokenFor("analyst")}`)
      .send({ uploadId: "upload1" });

    expect(res.status).toBe(200);
    expect(res.body.result.totalAnalyzed).toBe(10);
    expect(mockedService.analyzeBatch).toHaveBeenCalledWith({ uploadId: "upload1" });
  });

  it("scores by explicit transactionIds and passes an $in filter", async () => {
    mockedService.analyzeBatch.mockResolvedValueOnce({
      totalAnalyzed: 2,
      byRiskLevel: { LOW: 2, MEDIUM: 0, HIGH: 0, CRITICAL: 0 },
      failedTransactionIds: [],
      mlAvailable: true,
    });

    const res = await request(app)
      .post("/api/risk/analyze-batch")
      .set("Authorization", `Bearer ${tokenFor("admin")}`)
      .send({ transactionIds: ["txn_1", "txn_2"] });

    expect(res.status).toBe(200);
    expect(mockedService.analyzeBatch).toHaveBeenCalledWith({ transactionId: { $in: ["txn_1", "txn_2"] } });
  });

  it("scores everything when reanalyzeAll is true, passing an empty filter", async () => {
    mockedService.analyzeBatch.mockResolvedValueOnce({
      totalAnalyzed: 100,
      byRiskLevel: { LOW: 90, MEDIUM: 5, HIGH: 3, CRITICAL: 2 },
      failedTransactionIds: [],
      mlAvailable: true,
    });

    const res = await request(app)
      .post("/api/risk/analyze-batch")
      .set("Authorization", `Bearer ${tokenFor("admin")}`)
      .send({ reanalyzeAll: true });

    expect(res.status).toBe(200);
    expect(mockedService.analyzeBatch).toHaveBeenCalledWith({});
  });

  it("rejects a viewer's attempt to trigger batch analysis (403)", async () => {
    const res = await request(app)
      .post("/api/risk/analyze-batch")
      .set("Authorization", `Bearer ${tokenFor("viewer")}`)
      .send({ reanalyzeAll: true });
    expect(res.status).toBe(403);
  });
});

describe("GET /api/risk/summary", () => {
  const app = createApp();

  it("shapes the aggregation results into a summary response", async () => {
    mockedTxn.aggregate
      .mockResolvedValueOnce([
        { _id: "LOW", count: 80 },
        { _id: "HIGH", count: 15 },
        { _id: "CRITICAL", count: 5 },
      ])
      .mockResolvedValueOnce([{ _id: null, totalAmount: 500000, count: 20 }])
      .mockResolvedValueOnce([
        { _id: false, count: 90 },
        { _id: true, count: 10 },
      ]);
    mockedTxn.countDocuments.mockResolvedValueOnce(100);

    const res = await request(app).get("/api/risk/summary").set("Authorization", `Bearer ${tokenFor("viewer")}`);

    expect(res.status).toBe(200);
    expect(res.body.totalTransactions).toBe(100);
    expect(res.body.byRiskLevel.LOW).toBe(80);
    expect(res.body.byRiskLevel.HIGH).toBe(15);
    expect(res.body.byRiskLevel.MEDIUM).toBe(0);
    expect(res.body.simulatedExposure.amount).toBe(500000);
    expect(res.body.simulatedExposure.note).toContain("Simulated");
    expect(res.body.mlCoverage.scoredWithMl).toBe(90);
    expect(res.body.mlCoverage.rulesOnlyFallback).toBe(10);
  });

  it("handles an empty/unscored dataset gracefully", async () => {
    mockedTxn.aggregate.mockResolvedValueOnce([]).mockResolvedValueOnce([]).mockResolvedValueOnce([]);
    mockedTxn.countDocuments.mockResolvedValueOnce(0);

    const res = await request(app).get("/api/risk/summary").set("Authorization", `Bearer ${tokenFor("viewer")}`);

    expect(res.status).toBe(200);
    expect(res.body.totalTransactions).toBe(0);
    expect(res.body.simulatedExposure.amount).toBe(0);
    expect(res.body.mlCoverage.scoredWithMl).toBe(0);
  });
});
