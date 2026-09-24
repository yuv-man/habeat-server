import { Schema } from "mongoose";

export const LlmBatchJob = { name: "LlmBatchJob" };

/**
 * A Batch API job this server submitted and has not finished with. Kept in the
 * database, not memory: the answers can take hours, and the server may restart
 * in between.
 */
export interface ILlmBatchJob {
  name: string; // "batches/…"
  kind: string; // what to do with the answers, e.g. "behavior-analysis"
  model: string;
  keys: string[];
  status: "submitted" | "done" | "failed";
  submittedAt: Date;
  finishedAt?: Date | null;
  applied?: number;
}

export const LlmBatchJobSchema = new Schema<ILlmBatchJob>(
  {
    name: { type: String, required: true, unique: true },
    kind: { type: String, required: true },
    model: { type: String, required: true },
    keys: { type: [String], default: [] },
    status: { type: String, enum: ["submitted", "done", "failed"], default: "submitted" },
    submittedAt: { type: Date, default: () => new Date() },
    finishedAt: { type: Date, default: null },
    applied: { type: Number, default: 0 },
  },
  { collection: "llm_batch_jobs" },
);
LlmBatchJobSchema.index({ status: 1, kind: 1 });
