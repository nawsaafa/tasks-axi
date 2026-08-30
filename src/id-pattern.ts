/**
 * The one canonical task-id shape.
 *
 * Ids are caller-supplied join keys (decision D6), and three seams need the
 * same pattern: the markdown grammar (bullet + dependency-edge recognition),
 * `id.ts` (caller-supplied id validation), and `continuation.ts` (continuation
 * child ids). This module is a leaf - it imports nothing - so all three can
 * import it without a cycle and the pattern cannot drift.
 */

export const ID_CHARS = "[A-Za-z0-9][A-Za-z0-9._-]*";

/** A slug-shaped id that round-trips through the markdown grammar. */
export const ID_RE = new RegExp(`^${ID_CHARS}$`);
