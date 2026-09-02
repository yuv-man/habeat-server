import { JwtService } from "@nestjs/jwt";
import { AuthGuard } from "../../../src/auth/auth.guard";
import generateToken from "../../../src/utils/generateToken";

const SECRET = "repro-secret";

const ctx = (token: string): any => ({
  switchToHttp: () => ({
    getRequest: () => ({ headers: { authorization: `Bearer ${token}` } }),
  }),
});

const makeGuard = (dbUser: any) => {
  const jwt = new JwtService({ secret: SECRET });
  const config: any = { get: (k: string) => (k === "JWT_SECRET" ? SECRET : undefined) };
  const model: any = {
    findById: () => ({ select: () => ({ lean: async () => dbUser }) }),
  };
  return new AuthGuard(jwt, config, model);
};

describe("AuthGuard vs Google-style users (regression repro)", () => {
  const OLD = process.env.JWT_SECRET;
  beforeAll(() => { process.env.JWT_SECRET = SECRET; });
  afterAll(() => { process.env.JWT_SECRET = OLD; });

  const id = "507f1f77bcf86cd799439011";

  it("passes a user with tokenVersion=0 (email-style)", async () => {
    const token = generateToken(id, 0);
    await expect(makeGuard({ _id: id, tokenVersion: 0 }).canActivate(ctx(token))).resolves.toBe(true);
  });

  it("passes a Google-created user whose tokenVersion field is ABSENT", async () => {
    // OAuth create + lean() can yield a doc with no tokenVersion key.
    const token = generateToken(id, undefined); // signs tv=0
    await expect(makeGuard({ _id: id }).canActivate(ctx(token))).resolves.toBe(true);
  });

  it("rejects only when the version was actually bumped", async () => {
    const token = generateToken(id, 0);
    await expect(makeGuard({ _id: id, tokenVersion: 1 }).canActivate(ctx(token))).rejects.toThrow();
  });
});
