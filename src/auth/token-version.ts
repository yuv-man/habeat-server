/**
 * Token revocation check, shared by AuthGuard and JwtStrategy.
 *
 * A token embeds the user's tokenVersion at sign time. Bumping the stored
 * version (logout, incident response) makes every previously-issued token stale
 * — that is the revocation mechanism, and it works without shortening the token
 * lifetime, so mobile sessions stay long-lived.
 *
 * Both sides default to 0: tokens issued before this field existed carry no
 * version, and every user starts at 0, so old sessions validate until a
 * revocation actually happens. No forced mass logout on rollout.
 */
export function isTokenRevoked(
  payloadTv: number | undefined,
  userTokenVersion: number | undefined
): boolean {
  return (payloadTv ?? 0) !== (userTokenVersion ?? 0);
}
