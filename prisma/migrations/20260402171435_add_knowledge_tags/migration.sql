-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_KnowledgeEntry" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "category" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "tags" TEXT NOT NULL DEFAULT '',
    "source" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
INSERT INTO "new_KnowledgeEntry" ("category", "content", "createdAt", "id", "source") SELECT "category", "content", "createdAt", "id", "source" FROM "KnowledgeEntry";
DROP TABLE "KnowledgeEntry";
ALTER TABLE "new_KnowledgeEntry" RENAME TO "KnowledgeEntry";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
