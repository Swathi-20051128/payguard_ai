import request from "supertest";
import { createApp } from "../src/app";

describe("GET /api/health", () => {
  const app = createApp();

  it("returns 200 with service status and dependency block", async () => {
    const res = await request(app).get("/api/health");

    expect(res.status).toBe(200);
    expect(res.body.service).toBe("payguard-backend");
    expect(["ok", "degraded"]).toContain(res.body.status);
    expect(res.body.dependencies).toHaveProperty("mongodb");
    expect(res.body.dependencies).toHaveProperty("mlService");
  });
});

describe("GET /unknown-route", () => {
  const app = createApp();

  it("returns a structured 404", async () => {
    const res = await request(app).get("/api/does-not-exist");
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe("NOT_FOUND");
  });
});
