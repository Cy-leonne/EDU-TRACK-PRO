ALTER TABLE "School"
ADD COLUMN "publicId" TEXT;

UPDATE "School"
SET "publicId" = 'school_' || "id";

ALTER TABLE "School"
ALTER COLUMN "publicId" SET NOT NULL;

CREATE UNIQUE INDEX "School_publicId_key"
ON "School"("publicId");