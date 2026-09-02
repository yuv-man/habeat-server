import { ForbiddenException } from "@nestjs/common";

/**
 * Object-level authorization helpers.
 *
 * The controllers grew a pattern that *looked* like an ownership check but
 * wasn't:
 *
 *     const resolvedUserId = userId === "me" ? req.user._id.toString() : userId;
 *
 * That only special-cases the literal string "me". A real ObjectId in the URL
 * passes straight through, and the client always sends real IDs — so every one
 * of those endpoints let any authenticated user act on any other user's data
 * just by changing the id in the path.
 *
 * These helpers replace that pattern. The acting user is ALWAYS taken from the
 * verified token (req.user). A `:userId` still present in a route is treated as
 * an assertion to check, never as a source of authority.
 */

type AuthedUser = { _id: unknown };

/** The authenticated user's id as a string. The only trustworthy source of
 *  "who is acting" — it comes from the verified JWT, not the URL. */
export function actingUserId(req: { user?: AuthedUser }): string {
  const id = req?.user?._id;
  if (!id) {
    // AuthGuard should have populated this; if it didn't, fail closed.
    throw new ForbiddenException("Not authorized");
  }
  return String(id);
}

/**
 * Resolve the user a request acts on.
 *
 * `"me"` (or an absent param) → the authenticated user. Any other value must
 * equal the authenticated user's id, or it's a cross-account attempt and is
 * rejected. Use this everywhere a `:userId` param used to be trusted.
 */
export function resolveOwnUserId(
  req: { user?: AuthedUser },
  paramUserId?: string
): string {
  const self = actingUserId(req);
  if (!paramUserId || paramUserId === "me" || paramUserId === self) {
    return self;
  }
  throw new ForbiddenException("Access denied");
}

/**
 * Assert a loaded resource belongs to the acting user.
 *
 * For endpoints addressed by a resource id (goalId, planId, postId) rather than
 * a userId: fetch the resource, then call this with its owner field before
 * doing anything with it. Throws 404-as-403 — a plain "Access denied" so the
 * caller can't distinguish "not yours" from "doesn't exist" and enumerate ids.
 */
export function assertOwns(
  req: { user?: AuthedUser },
  resourceOwnerId: unknown
): void {
  if (!resourceOwnerId || String(resourceOwnerId) !== actingUserId(req)) {
    throw new ForbiddenException("Access denied");
  }
}
