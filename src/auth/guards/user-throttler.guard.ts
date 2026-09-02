import { Injectable } from "@nestjs/common";
import { ThrottlerGuard } from "@nestjs/throttler";

/**
 * Rate-limits by authenticated user, falling back to IP for anonymous routes.
 *
 * The default ThrottlerGuard keys on IP alone. For the expensive AI endpoints
 * that means an attacker who rotates IPs (trivial) sidesteps the limit while
 * still burning Gemini spend against valid accounts. Keying on the user id —
 * which requires a real token to obtain — ties the limit to an account, so
 * abuse costs the attacker an account per bucket instead of a free IP.
 */
@Injectable()
export class UserThrottlerGuard extends ThrottlerGuard {
  protected async getTracker(req: Record<string, any>): Promise<string> {
    const userId = req?.user?._id;
    if (userId) return `user:${String(userId)}`;
    // Anonymous: fall back to IP (login/signup already carry their own limits).
    return `ip:${req.ip ?? req.ips?.[0] ?? "unknown"}`;
  }
}
