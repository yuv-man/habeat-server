import mongoose from "mongoose";

/**
 * True only for non-empty 24-hex ObjectId strings.
 * Rejects the literal strings "undefined" / "null" (common client bugs).
 */
export function isMongoObjectIdString(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const s = value.trim();
  if (!s || s === "undefined" || s === "null") return false;
  return mongoose.Types.ObjectId.isValid(s);
}
