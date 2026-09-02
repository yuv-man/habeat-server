import jwt from "jsonwebtoken";

/**
 * Issues a signed access token.
 *
 * `tokenVersion` is embedded so the auth guard can reject tokens the user has
 * since revoked (see User.tokenVersion). The secret is required — a `|| ""`
 * fallback here meant that with JWT_SECRET unset every token was signed with an
 * empty key, i.e. forgeable by anyone. Fail closed instead.
 */
const generateToken = (id: string, tokenVersion = 0): string => {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    throw new Error(
      "JWT_SECRET is not configured. Refusing to sign a token without a secret."
    );
  }
  const options: jwt.SignOptions = {
    expiresIn: (process.env.JWT_EXPIRES_IN ||
      "30d") as jwt.SignOptions["expiresIn"],
  };
  return jwt.sign({ id, tv: tokenVersion }, secret, options);
};

export default generateToken;
