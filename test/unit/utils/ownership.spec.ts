import { ForbiddenException } from "@nestjs/common";
import {
  actingUserId,
  resolveOwnUserId,
  assertOwns,
} from "../../../src/utils/ownership";

describe("ownership helpers (object-level authorization)", () => {
  const me = { user: { _id: "myId1234" } };

  describe("resolveOwnUserId", () => {
    it("rejects a foreign userId in the URL (the IDOR the old ternary allowed)", () => {
      expect(() => resolveOwnUserId(me, "victimId9999")).toThrow(
        ForbiddenException
      );
    });

    it("resolves 'me' to the authenticated user", () => {
      expect(resolveOwnUserId(me, "me")).toBe("myId1234");
    });

    it("resolves an absent param to the authenticated user", () => {
      expect(resolveOwnUserId(me)).toBe("myId1234");
    });

    it("allows a param that equals the authenticated user", () => {
      expect(resolveOwnUserId(me, "myId1234")).toBe("myId1234");
    });
  });

  describe("assertOwns", () => {
    it("blocks a resource owned by someone else", () => {
      expect(() => assertOwns(me, "victimId9999")).toThrow(ForbiddenException);
    });

    it("allows a resource the caller owns", () => {
      expect(() => assertOwns(me, "myId1234")).not.toThrow();
    });

    it("blocks when the resource has no owner", () => {
      expect(() => assertOwns(me, undefined)).toThrow(ForbiddenException);
    });
  });

  describe("actingUserId", () => {
    it("fails closed when the request has no authenticated user", () => {
      expect(() => actingUserId({} as any)).toThrow(ForbiddenException);
    });
  });
});
