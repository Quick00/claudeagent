CREATE EXTENSION IF NOT EXISTS vector;
ALTER TABLE "KnowledgeEntry" ADD COLUMN "embedding" vector(3072);
CREATE INDEX "KnowledgeEntry_embedding_idx" ON "KnowledgeEntry" USING hnsw (embedding vector_cosine_ops);
