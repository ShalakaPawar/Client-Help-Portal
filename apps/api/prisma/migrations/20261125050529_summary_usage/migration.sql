-- AlterTable
ALTER TABLE "Summary" ADD COLUMN     "inputTokens" INTEGER,
ADD COLUMN     "latencyMs" INTEGER,
ADD COLUMN     "outputTokens" INTEGER;
