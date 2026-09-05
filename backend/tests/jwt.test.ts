import { signToken, verifyToken } from "../src/utils/jwt";

describe("jwt utils", () => {
  it("signs a payload and verifies it back to the same values", () => {
    const token = signToken({ sub: "user123", role: "analyst", email: "a@b.com" });
    const decoded = verifyToken(token);

    expect(decoded.sub).toBe("user123");
    expect(decoded.role).toBe("analyst");
    expect(decoded.email).toBe("a@b.com");
  });

  it("throws on a tampered token", () => {
    const token = signToken({ sub: "user123", role: "viewer", email: "a@b.com" });
    const tampered = token.slice(0, -2) + "xx";
    expect(() => verifyToken(tampered)).toThrow();
  });
});
