import { isTokenRevoked } from "../../../src/auth/token-version";
import generateToken from "../../../src/utils/generateToken";
import jwt from "jsonwebtoken";

describe("isTokenRevoked", () => {
  it("accepts a token whose version matches the user", () => {
    expect(isTokenRevoked(3, 3)).toBe(false);
  });

  it("rejects a token older than the user's current version (revoked)", () => {
    // User logged out -> version bumped to 4; the old token still carries 3.
    expect(isTokenRevoked(3, 4)).toBe(true);
  });

  it("treats a pre-revocation token (no tv) as version 0 — still valid for a fresh user", () => {
    expect(isTokenRevoked(undefined, 0)).toBe(false);
    expect(isTokenRevoked(undefined, undefined)).toBe(false);
  });

  it("rejects a legacy no-tv token once the user has revoked at least once", () => {
    expect(isTokenRevoked(undefined, 1)).toBe(true);
  });
});

describe("generateToken", () => {
  const OLD = process.env.JWT_SECRET;
  beforeAll(() => {
    process.env.JWT_SECRET = "test-secret-for-unit";
  });
  afterAll(() => {
    process.env.JWT_SECRET = OLD;
  });

  it("embeds the id and token version", () => {
    const token = generateToken("507f1f77bcf86cd799439011", 7);
    const decoded = jwt.verify(token, "test-secret-for-unit") as any;
    expect(decoded.id).toBe("507f1f77bcf86cd799439011");
    expect(decoded.tv).toBe(7);
  });

  it("defaults the version to 0", () => {
    const decoded = jwt.verify(
      generateToken("507f1f77bcf86cd799439011"),
      "test-secret-for-unit"
    ) as any;
    expect(decoded.tv).toBe(0);
  });

  it("refuses to sign without a secret (fail closed)", () => {
    const saved = process.env.JWT_SECRET;
    delete process.env.JWT_SECRET;
    expect(() => generateToken("507f1f77bcf86cd799439011")).toThrow(
      /JWT_SECRET is not configured/
    );
    process.env.JWT_SECRET = saved;
  });
});
