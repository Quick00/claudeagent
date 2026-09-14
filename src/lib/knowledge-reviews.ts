import { prisma } from '@/lib/prisma';
import { updateEntry, refreshSourcesToHead } from '@/lib/knowledge-admin';

export type ReviewAction = 'accept' | 'dismiss';

interface ReviewLike {
  id: string;
  entryId: string;
  type: string;
  payload: unknown;
}

/** Read a required non-empty string out of a `Json` payload, or fail. */
function requireString(payload: unknown, key: string, reviewType: string): string {
  const value = payload && typeof payload === 'object' ? (payload as Record<string, unknown>)[key] : undefined;
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`Malformed ${reviewType} payload: expected a non-empty string "${key}"`);
  }
  return value;
}

/**
 * Validate that the review's `payload` (model- or process-generated Json,
 * never trusted) has the shape its type requires, before anything is
 * written. Returns the content the accept step needs to apply, if any.
 */
function validateForAccept(review: ReviewLike): { content?: string } {
  switch (review.type) {
    case 'pinned_conflict':
      return { content: requireString(review.payload, 'proposedContent', review.type) };
    case 'proposed_update':
      return { content: requireString(review.payload, 'suggestedContent', review.type) };
    case 'supersedes':
      // Retires the review's own entry; nothing is read from the payload.
      return {};
    default:
      throw new Error(`Unknown review type: ${review.type}`);
  }
}

async function applyAccept(review: ReviewLike, content: string | undefined): Promise<void> {
  if (review.type === 'pinned_conflict') {
    await updateEntry(review.entryId, { content: content! });
  } else if (review.type === 'supersedes') {
    await updateEntry(review.entryId, { status: 'retired' });
  } else if (review.type === 'proposed_update') {
    await updateEntry(review.entryId, { content: content! });
    await refreshSourcesToHead(review.entryId);
  }
}

/**
 * Apply a human decision to a queued KnowledgeReview.
 *
 * Accept semantics:
 * - pinned_conflict: the pinned entry's content becomes `payload.proposedContent`.
 * - supersedes: the review's own entry (the stale page) is retired.
 * - proposed_update: the entry's content becomes `payload.suggestedContent`
 *   and its sources are refreshed to HEAD — refused if the entry has been
 *   pinned since the review was queued.
 * Dismiss just closes the review — no entry is touched.
 *
 * Race-safety: the "open" -> "resolved" transition is a conditional
 * `updateMany` (`where: { id, status: 'open' }`), not a read-then-write. Two
 * admins racing the same review can never both apply it: whichever caller's
 * `updateMany` fails to match a row (because the other already claimed it)
 * throws instead of proceeding. The payload is validated *before* that claim
 * is made, so a malformed payload never claims the review and never reaches
 * an entry write. If the accept mutation itself unexpectedly fails after the
 * claim succeeded, the claim is reverted (status back to "open", resolvedAt
 * and resolvedById cleared) so the review is never left marked resolved
 * without the corresponding change having actually been applied.
 */
export async function resolveReview(reviewId: string, action: ReviewAction, adminId: string): Promise<void> {
  const review = await prisma.knowledgeReview.findUnique({ where: { id: reviewId } });
  if (!review) throw new Error('Review not found');
  if (review.status !== 'open') throw new Error('Review already resolved');

  const toApply = action === 'accept' ? validateForAccept(review) : {};

  // A proposed_update carries model-authored text. The entry may have been
  // pinned after the review was queued, and a pinned entry is human-owned:
  // accepting would write Claude's words into a rule Claude may never touch.
  // (pinned_conflict is the opposite case — overwriting the pinned rule with
  // the admin-approved text is its whole purpose — so it stays allowed.)
  if (action === 'accept' && review.type === 'proposed_update') {
    const entry = await prisma.knowledgeEntry.findUnique({ where: { id: review.entryId }, select: { kind: true } });
    if (!entry) throw new Error('Entry not found');
    if (entry.kind === 'pinned') {
      throw new Error('This entry is pinned; a proposed update cannot be applied to a human-owned rule. Edit it directly or unpin it first.');
    }
  }

  const claimed = await prisma.knowledgeReview.updateMany({
    where: { id: reviewId, status: 'open' },
    data: { status: 'resolved', resolvedAt: new Date(), resolvedById: adminId },
  });
  if (claimed.count === 0) {
    throw new Error('Review already resolved');
  }

  if (action === 'dismiss') return;

  try {
    await applyAccept(review, toApply.content);
  } catch (err) {
    await prisma.knowledgeReview.update({
      where: { id: reviewId },
      data: { status: 'open', resolvedAt: null, resolvedById: null },
    });
    throw err;
  }
}
