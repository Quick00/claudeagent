import type { Prisma } from '@prisma/client';
import { prisma } from '@/lib/prisma';

export type ReviewType = 'pinned_conflict' | 'supersedes' | 'proposed_update';

/**
 * Queue a KnowledgeReview for an admin, at most one open row per
 * (entry, type).
 *
 * Every producer of reviews is a repeating process — a recurring chat topic
 * that keeps contradicting the same pinned rule, repeated quick checks of the
 * same stale page, several creates landing next to one stale page — so
 * creating a row unconditionally floods the Reviews tab with near-identical
 * rows an admin has to dismiss one at a time. The existing open row already
 * says "a human needs to look at this entry for this reason"; the newest
 * payload replaces its content so the admin decides on the latest suggestion.
 *
 * Lives in its own module (rather than in knowledge-reviews.ts) so that
 * knowledge-save.ts can use it without an import cycle through
 * knowledge-admin.ts.
 */
export async function createOpenReview(
  entryId: string,
  type: ReviewType,
  payload: Prisma.InputJsonObject,
): Promise<string> {
  const existing = await prisma.knowledgeReview.findFirst({
    where: { entryId, type, status: 'open' },
    orderBy: { createdAt: 'desc' },
  });
  if (existing) {
    await prisma.knowledgeReview.update({ where: { id: existing.id }, data: { payload } });
    return existing.id;
  }
  const review = await prisma.knowledgeReview.create({ data: { entryId, type, payload } });
  return review.id;
}
