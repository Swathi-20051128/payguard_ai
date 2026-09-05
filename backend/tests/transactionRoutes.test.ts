import request from "supertest";
import { createApp } from "../src/app";
import { Transaction } from "../src/models/Transaction";
import { Upload } from "../src/models/Upload";
import { signToken } from "../src/utils/jwt";

jest.mock("../src/models/Transaction", () => ({
  Transaction: {
    insertMany: jest.fn(),
    find: jest.fn(),
    countDocuments: jest.fn(),
    findOne: jest.fn(),
  },
}));

jest.mock("../src/models/Upload", () => ({
  Upload: {
    create: jest.fn(),
    find: jest.fn(),
  },
}));

const mockedTxn = Transaction as unknown as {
  insertMany: jest.Mock;
  find: jest.Mock;
  countDocuments: jest.Mock;
  findOne: jest.Mock;
};
const mockedUpload = Upload as unknown as { create: jest.Mock; find: jest.Mock };

function tokenFor(role: "admin" | "analyst" | "viewer") {
  return signToken({ sub: "u1", role, email: `${role}@example.com` });
}

function mockUploadDoc(overrides: Record<string, unknown> = {}) {
  const doc: any = {
    id: "upload1",
    filename: "test.csv",
    source: "csv",
    status: "processing",
    totalRows: 0,
    insertedCount: 0,
    duplicateCount: 0,
    invalidCount: 0,
    sampleErrors: [],
    ...overrides,
  };
  doc.save = jest.fn().mockResolvedValue(doc);
  return doc;
}

beforeEach(() => {
  jest.resetAllMocks();
});

describe("Transaction routes — auth gating", () => {
  const app = createApp();

  it("rejects unauthenticated requests to upload", async () => {
    const res = await request(app).post("/api/transactions/upload");
    expect(res.status).toBe(401);
  });

  it("rejects a viewer's attempt to upload (403)", async () => {
    const res = await request(app)
      .post("/api/transactions/upload")
      .set("Authorization", `Bearer ${tokenFor("viewer")}`)
      .attach("file", Buffer.from("a,b\n1,2"), "test.csv");
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe("FORBIDDEN");
  });

  it("rejects a viewer's attempt to generate sample data (403)", async () => {
    const res = await request(app)
      .post("/api/transactions/generate-sample")
      .set("Authorization", `Bearer ${tokenFor("viewer")}`)
      .send({});
    expect(res.status).toBe(403);
  });

  it("allows a viewer to read the transaction list", async () => {
    mockedTxn.find.mockReturnValue({
      sort: jest.fn().mockReturnThis(),
      skip: jest.fn().mockReturnThis(),
      limit: jest.fn().mockResolvedValue([]),
    });
    mockedTxn.countDocuments.mockResolvedValue(0);

    const res = await request(app).get("/api/transactions").set("Authorization", `Bearer ${tokenFor("viewer")}`);
    expect(res.status).toBe(200);
  });
});

describe("POST /api/transactions/upload", () => {
  const app = createApp();

  it("returns 400 when no file is attached", async () => {
    const res = await request(app)
      .post("/api/transactions/upload")
      .set("Authorization", `Bearer ${tokenFor("analyst")}`);
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("NO_FILE");
  });

  it("rejects a non-csv/json file", async () => {
    const res = await request(app)
      .post("/api/transactions/upload")
      .set("Authorization", `Bearer ${tokenFor("analyst")}`)
      .attach("file", Buffer.from("not a csv"), "malware.exe");
    expect(res.status).toBe(415);
    expect(res.body.error.code).toBe("UNSUPPORTED_FILE_TYPE");
  });

  it("ingests a valid CSV and reports counts", async () => {
    const uploadDoc = mockUploadDoc();
    mockedUpload.create.mockResolvedValueOnce(uploadDoc);
    mockedTxn.insertMany.mockResolvedValueOnce([{ id: "t1" }]);

    const csv = [
      "transactionId,orderId,merchantId,customerId,amount,currency,status,paymentMethod,cardToken,deviceId,ipHash,country,city,timestamp,refundAmount,chargebackFlag,failureReason",
      "txn_1,order_1,merchant_1,customer_1,100,INR,success,card,card_token_1,device_1,ip_hash_1,IN,Mumbai,2026-01-01T00:00:00Z,0,false,",
    ].join("\n");

    const res = await request(app)
      .post("/api/transactions/upload")
      .set("Authorization", `Bearer ${tokenFor("analyst")}`)
      .attach("file", Buffer.from(csv), "test.csv");

    expect(res.status).toBe(201);
    expect(mockedUpload.create).toHaveBeenCalledWith(
      expect.objectContaining({ filename: "test.csv", source: "csv" })
    );
    expect(mockedTxn.insertMany).toHaveBeenCalled();
    expect(uploadDoc.save).toHaveBeenCalled();
    expect(res.body.upload.insertedCount).toBe(1);
  });

  it("classifies an invalid row without crashing the batch", async () => {
    const uploadDoc = mockUploadDoc();
    mockedUpload.create.mockResolvedValueOnce(uploadDoc);
    mockedTxn.insertMany.mockResolvedValueOnce([]);

    // Missing required fields (merchantId, customerId, etc.)
    const csv = ["transactionId,orderId", "txn_bad,order_bad"].join("\n");

    const res = await request(app)
      .post("/api/transactions/upload")
      .set("Authorization", `Bearer ${tokenFor("admin")}`)
      .attach("file", Buffer.from(csv), "bad.csv");

    expect(res.status).toBe(201);
    expect(res.body.upload.invalidCount).toBe(1);
    expect(res.body.upload.insertedCount).toBe(0);
  });
});

describe("POST /api/transactions/generate-sample", () => {
  const app = createApp();

  it("generates and ingests a small synthetic dataset", async () => {
    const uploadDoc = mockUploadDoc({ source: "generated" });
    mockedUpload.create.mockResolvedValueOnce(uploadDoc);
    mockedTxn.insertMany.mockImplementation(async (docs: unknown[]) => docs.map((_, i) => ({ id: `gen${i}` })));

    const res = await request(app)
      .post("/api/transactions/generate-sample")
      .set("Authorization", `Bearer ${tokenFor("analyst")}`)
      .send({ transactionCount: 200, customerCount: 20, merchantCount: 5, deviceCount: 30, cardTokenCount: 40, ipHashCount: 30 });

    expect(res.status).toBe(201);
    expect(res.body.upload.totalRows).toBe(200);
    expect(res.body.upload.insertedCount).toBe(200);
    expect(res.body.scenarioCounts).toBeDefined();
  });

  it("rejects an out-of-range transactionCount", async () => {
    const res = await request(app)
      .post("/api/transactions/generate-sample")
      .set("Authorization", `Bearer ${tokenFor("admin")}`)
      .send({ transactionCount: 999999 });

    expect(res.status).toBe(422);
  });
});

describe("GET /api/transactions/:transactionId", () => {
  const app = createApp();

  it("returns 404 for an unknown transaction", async () => {
    mockedTxn.findOne.mockResolvedValueOnce(null);
    const res = await request(app)
      .get("/api/transactions/does-not-exist")
      .set("Authorization", `Bearer ${tokenFor("viewer")}`);
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe("TRANSACTION_NOT_FOUND");
  });

  it("returns the transaction when found", async () => {
    mockedTxn.findOne.mockResolvedValueOnce({ transactionId: "txn_1", amount: 100 });
    const res = await request(app)
      .get("/api/transactions/txn_1")
      .set("Authorization", `Bearer ${tokenFor("viewer")}`);
    expect(res.status).toBe(200);
    expect(res.body.transaction.transactionId).toBe("txn_1");
  });
});

describe("GET /api/transactions/uploads", () => {
  const app = createApp();

  it("returns upload history", async () => {
    mockedUpload.find.mockReturnValue({
      sort: jest.fn().mockReturnThis(),
      limit: jest.fn().mockReturnThis(),
      populate: jest.fn().mockResolvedValue([mockUploadDoc()]),
    });

    const res = await request(app)
      .get("/api/transactions/uploads")
      .set("Authorization", `Bearer ${tokenFor("viewer")}`);

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.uploads)).toBe(true);
    expect(res.body.uploads).toHaveLength(1);
  });
});
