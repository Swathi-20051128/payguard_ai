import { comparePassword, hashPassword } from "../src/utils/password";

describe("password utils", () => {
  it("hashes a password and can verify it matches", async () => {
    const hash = await hashPassword("SuperSecret123!");
    expect(hash).not.toBe("SuperSecret123!");
    await expect(comparePassword("SuperSecret123!", hash)).resolves.toBe(true);
  });

  it("rejects an incorrect password against a hash", async () => {
    const hash = await hashPassword("SuperSecret123!");
    await expect(comparePassword("WrongPassword", hash)).resolves.toBe(false);
  });
});
