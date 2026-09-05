import { AppError } from "../src/middleware/errorHandler";
import { User } from "../src/models/User";
import { loginUser, registerUser } from "../src/services/authService";
import { hashPassword } from "../src/utils/password";

jest.mock("../src/models/User", () => {
  const actual = jest.requireActual("../src/models/User");
  return {
    ...actual,
    User: {
      findOne: jest.fn(),
      create: jest.fn(),
    },
  };
});

const mockedUser = User as unknown as { findOne: jest.Mock; create: jest.Mock };

describe("authService.registerUser", () => {
  it("creates a new user as role=viewer regardless of requested role", async () => {
    mockedUser.findOne.mockResolvedValueOnce(null);
    mockedUser.create.mockResolvedValueOnce({
      id: "u1",
      name: "Jane",
      email: "jane@example.com",
      role: "viewer",
      isActive: true,
    });

    const result = await registerUser({
      name: "Jane",
      email: "jane@example.com",
      password: "SuperSecret123!",
      role: "admin", // attempted privilege escalation — must be ignored
    });

    expect(mockedUser.create).toHaveBeenCalledWith(
      expect.objectContaining({ email: "jane@example.com", role: "viewer" })
    );
    expect(result.user.role).toBe("viewer");
    expect(result.token).toEqual(expect.any(String));
  });

  it("rejects registration when the email is already in use", async () => {
    mockedUser.findOne.mockResolvedValueOnce({ id: "existing" });

    await expect(
      registerUser({ name: "Jane", email: "jane@example.com", password: "SuperSecret123!" })
    ).rejects.toThrow(AppError);
  });
});

describe("authService.loginUser", () => {
  it("logs in with correct credentials and returns a token", async () => {
    const passwordHash = await hashPassword("CorrectHorse123!");
    mockedUser.findOne.mockReturnValueOnce({
      select: jest.fn().mockResolvedValueOnce({
        id: "u2",
        name: "Analyst",
        email: "analyst@example.com",
        role: "analyst",
        isActive: true,
        passwordHash,
      }),
    });

    const result = await loginUser({ email: "analyst@example.com", password: "CorrectHorse123!" });

    expect(result.token).toEqual(expect.any(String));
    expect(result.user.role).toBe("analyst");
  });

  it("rejects an unknown email with a generic error", async () => {
    mockedUser.findOne.mockReturnValueOnce({ select: jest.fn().mockResolvedValueOnce(null) });

    await expect(loginUser({ email: "nobody@example.com", password: "whatever" })).rejects.toMatchObject({
      code: "INVALID_CREDENTIALS",
    });
  });

  it("rejects a deactivated account even with the correct password", async () => {
    const passwordHash = await hashPassword("CorrectHorse123!");
    mockedUser.findOne.mockReturnValueOnce({
      select: jest.fn().mockResolvedValueOnce({
        id: "u3",
        email: "disabled@example.com",
        role: "viewer",
        isActive: false,
        passwordHash,
      }),
    });

    await expect(
      loginUser({ email: "disabled@example.com", password: "CorrectHorse123!" })
    ).rejects.toMatchObject({ code: "ACCOUNT_DISABLED" });
  });

  it("rejects an incorrect password with a generic error (no account enumeration)", async () => {
    const passwordHash = await hashPassword("CorrectHorse123!");
    mockedUser.findOne.mockReturnValueOnce({
      select: jest.fn().mockResolvedValueOnce({
        id: "u4",
        email: "analyst@example.com",
        role: "analyst",
        isActive: true,
        passwordHash,
      }),
    });

    await expect(
      loginUser({ email: "analyst@example.com", password: "WrongPassword" })
    ).rejects.toMatchObject({ code: "INVALID_CREDENTIALS" });
  });
});
