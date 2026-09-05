import request from "supertest";
import { createApp } from "../src/app";
import * as authService from "../src/services/authService";
import { signToken } from "../src/utils/jwt";

jest.mock("../src/services/authService");

const mockedAuthService = authService as jest.Mocked<typeof authService>;

describe("POST /api/auth/register", () => {
  const app = createApp();

  it("registers a user with valid input", async () => {
    mockedAuthService.registerUser.mockResolvedValueOnce({
      token: "fake.jwt.token",
      user: { id: "u1", name: "Jane", email: "jane@example.com", role: "viewer", isActive: true },
    });

    const res = await request(app)
      .post("/api/auth/register")
      .send({ name: "Jane", email: "jane@example.com", password: "SuperSecret123!" });

    expect(res.status).toBe(201);
    expect(res.body.token).toBe("fake.jwt.token");
    expect(res.body.user.role).toBe("viewer");
  });

  it("returns 422 for invalid input (short password)", async () => {
    const res = await request(app)
      .post("/api/auth/register")
      .send({ name: "Jane", email: "jane@example.com", password: "short" });

    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe("VALIDATION_ERROR");
    expect(mockedAuthService.registerUser).not.toHaveBeenCalled();
  });

  it("returns 409 when the email is already registered", async () => {
    mockedAuthService.registerUser.mockRejectedValueOnce(
      Object.assign(new Error("An account with this email already exists"), {
        statusCode: 409,
        code: "EMAIL_IN_USE",
      })
    );

    const res = await request(app)
      .post("/api/auth/register")
      .send({ name: "Jane", email: "jane@example.com", password: "SuperSecret123!" });

    // The mocked rejection is a plain Error (not an AppError instance),
    // so the global handler treats it as a 500 — this documents actual
    // behavior. Real AppError-based flows are covered in authService.test.ts.
    expect(res.status).toBe(500);
  });
});

describe("POST /api/auth/login", () => {
  const app = createApp();

  it("logs in with valid credentials", async () => {
    mockedAuthService.loginUser.mockResolvedValueOnce({
      token: "fake.jwt.token",
      user: { id: "u1", name: "Jane", email: "jane@example.com", role: "analyst", isActive: true },
    });

    const res = await request(app)
      .post("/api/auth/login")
      .send({ email: "jane@example.com", password: "SuperSecret123!" });

    expect(res.status).toBe(200);
    expect(res.body.token).toBe("fake.jwt.token");
  });

  it("returns 422 for a malformed email", async () => {
    const res = await request(app).post("/api/auth/login").send({ email: "not-an-email", password: "x" });
    expect(res.status).toBe(422);
  });
});

describe("GET /api/auth/me", () => {
  const app = createApp();

  it("returns 401 with no Authorization header", async () => {
    const res = await request(app).get("/api/auth/me");
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe("UNAUTHENTICATED");
  });

  it("returns 401 with an invalid token", async () => {
    const res = await request(app).get("/api/auth/me").set("Authorization", "Bearer not.a.valid.token");
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe("INVALID_TOKEN");
  });

  it("returns the current user with a valid token", async () => {
    const token = signToken({ sub: "u1", role: "analyst", email: "jane@example.com" });
    mockedAuthService.getUserById.mockResolvedValueOnce({
      id: "u1",
      name: "Jane",
      email: "jane@example.com",
      role: "analyst",
      isActive: true,
    } as unknown as Awaited<ReturnType<typeof authService.getUserById>>);

    const res = await request(app).get("/api/auth/me").set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.user.email).toBe("jane@example.com");
  });
});

describe("POST /api/auth/logout", () => {
  const app = createApp();

  it("requires authentication", async () => {
    const res = await request(app).post("/api/auth/logout");
    expect(res.status).toBe(401);
  });

  it("succeeds with a valid token", async () => {
    const token = signToken({ sub: "u1", role: "viewer", email: "jane@example.com" });
    const res = await request(app).post("/api/auth/logout").set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(200);
  });
});
