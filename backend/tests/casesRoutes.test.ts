import request from "supertest";
import { createApp } from "../src/app";
import { AppError } from "../src/middleware/errorHandler";
import { Case } from "../src/models/Case";
import * as caseService from "../src/services/caseService";
import { signToken } from "../src/utils/jwt";

jest.mock("../src/models/Case", () => ({
  Case: {
    find: jest.fn(),
    findById: jest.fn(),
    countDocuments: jest.fn(),
  },
}));

jest.mock("../src/services/caseService", () => ({
  createCase: jest.fn(),
  assignCase: jest.fn(),
  decideCase: jest.fn(),
  performCaseAction: jest.fn(),
}));

const mockedCase = Case as unknown as { find: jest.Mock; findById: jest.Mock; countDocuments: jest.Mock };
const mockedService = caseService as jest.Mocked<typeof caseService>;

function tokenFor(role: "admin" | "analyst" | "viewer") {
  return signToken({ sub: "u1", role, email: `${role}@example.com` });
}

beforeEach(() => {
  jest.resetAllMocks();
});

describe("POST /api/cases", () => {
  const app = createApp();

  it("requires authentication", async () => {
    const res = await request(app).post("/api/cases").send({ alertIds: ["a1"] });
    expect(res.status).toBe(401);
  });

  it("rejects a viewer (403)", async () => {
    const res = await request(app)
      .post("/api/cases")
      .set("Authorization", `Bearer ${tokenFor("viewer")}`)
      .send({ alertIds: ["a1"] });
    expect(res.status).toBe(403);
  });

  it("rejects an empty alertIds array", async () => {
    const res = await request(app)
      .post("/api/cases")
      .set("Authorization", `Bearer ${tokenFor("analyst")}`)
      .send({ alertIds: [] });
    expect(res.status).toBe(422);
  });

  it("creates a case and passes the actor context through", async () => {
    mockedService.createCase.mockResolvedValueOnce({ id: "case1", status: "OPEN" } as any);

    const res = await request(app)
      .post("/api/cases")
      .set("Authorization", `Bearer ${tokenFor("analyst")}`)
      .send({ alertIds: ["a1", "a2"] });

    expect(res.status).toBe(201);
    expect(res.body.case.id).toBe("case1");
    expect(mockedService.createCase).toHaveBeenCalledWith(["a1", "a2"], expect.objectContaining({ userId: "u1" }));
  });

  it("propagates a service-level AppError (e.g. alert not found) with its status code", async () => {
    mockedService.createCase.mockRejectedValueOnce(
      new AppError("One or more alertIds were not found", 404, "ALERT_NOT_FOUND")
    );

    const res = await request(app)
      .post("/api/cases")
      .set("Authorization", `Bearer ${tokenFor("analyst")}`)
      .send({ alertIds: ["bad-id"] });

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe("ALERT_NOT_FOUND");
  });
});

describe("GET /api/cases", () => {
  const app = createApp();

  it("allows a viewer to list cases", async () => {
    const chain: any = {
      sort: jest.fn().mockReturnThis(),
      skip: jest.fn().mockReturnThis(),
      limit: jest.fn().mockReturnThis(),
    };
    chain.populate = jest.fn().mockImplementation(() => chain);
    // Make the chain awaitable (Mongoose query thenable) by resolving to []
    chain.then = (resolve: (v: unknown) => void) => resolve([]);
    mockedCase.find.mockReturnValue(chain);
    mockedCase.countDocuments.mockResolvedValue(0);

    const res = await request(app).get("/api/cases").set("Authorization", `Bearer ${tokenFor("viewer")}`);
    expect(res.status).toBe(200);
  });
});

describe("GET /api/cases/:caseId", () => {
  const app = createApp();

  function chainable(resolvedValue: unknown) {
    const chain: any = {};
    chain.populate = jest.fn().mockReturnValue(chain);
    chain.then = (resolve: (v: unknown) => void) => resolve(resolvedValue);
    return chain;
  }

  it("returns 404 for an unknown case", async () => {
    mockedCase.findById.mockReturnValueOnce(chainable(null));
    const res = await request(app)
      .get("/api/cases/does-not-exist")
      .set("Authorization", `Bearer ${tokenFor("viewer")}`);
    expect(res.status).toBe(404);
  });

  it("returns the case when found", async () => {
    mockedCase.findById.mockReturnValueOnce(chainable({ id: "case1", status: "OPEN" }));
    const res = await request(app).get("/api/cases/case1").set("Authorization", `Bearer ${tokenFor("viewer")}`);
    expect(res.status).toBe(200);
    expect(res.body.case.id).toBe("case1");
  });
});

describe("PATCH /api/cases/:caseId/assign", () => {
  const app = createApp();

  it("rejects a viewer (403)", async () => {
    const res = await request(app)
      .patch("/api/cases/case1/assign")
      .set("Authorization", `Bearer ${tokenFor("viewer")}`)
      .send({ assignedTo: "user2" });
    expect(res.status).toBe(403);
  });

  it("delegates to caseService.assignCase", async () => {
    mockedService.assignCase.mockResolvedValueOnce({ id: "case1", assignedTo: "user2" } as any);
    const res = await request(app)
      .patch("/api/cases/case1/assign")
      .set("Authorization", `Bearer ${tokenFor("admin")}`)
      .send({ assignedTo: "user2" });
    expect(res.status).toBe(200);
    expect(mockedService.assignCase).toHaveBeenCalledWith("case1", "user2", expect.objectContaining({ userId: "u1" }));
  });
});

describe("PATCH /api/cases/:caseId/decision", () => {
  const app = createApp();

  it("rejects an invalid decision value", async () => {
    const res = await request(app)
      .patch("/api/cases/case1/decision")
      .set("Authorization", `Bearer ${tokenFor("analyst")}`)
      .send({ decision: "not_a_real_decision" });
    expect(res.status).toBe(422);
  });

  it("delegates to caseService.decideCase", async () => {
    mockedService.decideCase.mockResolvedValueOnce({ id: "case1", status: "DISMISSED" } as any);
    const res = await request(app)
      .patch("/api/cases/case1/decision")
      .set("Authorization", `Bearer ${tokenFor("analyst")}`)
      .send({ decision: "dismissed", comment: "false positive" });
    expect(res.status).toBe(200);
    expect(mockedService.decideCase).toHaveBeenCalledWith(
      "case1",
      { decision: "dismissed", comment: "false positive" },
      expect.objectContaining({ userId: "u1" })
    );
  });
});

describe("POST /api/cases/:caseId/actions", () => {
  const app = createApp();

  it("rejects an unknown actionType", async () => {
    const res = await request(app)
      .post("/api/cases/case1/actions")
      .set("Authorization", `Bearer ${tokenFor("analyst")}`)
      .send({ actionType: "block_real_payment" }); // not a real, safe action type
    expect(res.status).toBe(422);
  });

  it("delegates a valid action to caseService.performCaseAction", async () => {
    mockedService.performCaseAction.mockResolvedValueOnce({
      actionType: "review_hold",
      simulated: true,
      message: "A simulated review hold has been placed on this case.",
    });

    const res = await request(app)
      .post("/api/cases/case1/actions")
      .set("Authorization", `Bearer ${tokenFor("admin")}`)
      .send({ actionType: "review_hold" });

    expect(res.status).toBe(200);
    expect(res.body.result.simulated).toBe(true);
  });

  it("rejects a viewer attempting an action (403)", async () => {
    const res = await request(app)
      .post("/api/cases/case1/actions")
      .set("Authorization", `Bearer ${tokenFor("viewer")}`)
      .send({ actionType: "review_hold" });
    expect(res.status).toBe(403);
  });
});
