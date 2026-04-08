CREATE EXTENSION IF NOT EXISTS vector;
ALTER TABLE "KnowledgeEntry" ADD COLUMN "embedding" vector(1024);
CREATE INDEX "KnowledgeEntry_embedding_idx" ON "KnowledgeEntry" USING hnsw (embedding vector_cosine_ops);
