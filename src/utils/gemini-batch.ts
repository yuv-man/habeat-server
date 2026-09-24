/**
 * Gemini Batch API: many requests in one job, answered within 24 hours at half
 * the price of calling them one by one. For work nobody is waiting on — the
 * nightly behaviour analysis. https://ai.google.dev/gemini-api/docs/batch-mode
 *
 * The body builders and the reader are pure, so they can be tested without
 * the network; submit/get are thin HTTP calls around them.
 */
import axios from "axios";

const BASE = "https://generativelanguage.googleapis.com/v1beta";

export interface BatchRequest {
  /** Returned with the answer; here, the user id. */
  key: string;
  prompt: string;
}

export interface BatchAnswer {
  key: string;
  text: string | null;
  usage: any | null;
  error: string | null;
}

export type BatchState = "pending" | "running" | "succeeded" | "failed";

export interface BatchStatus {
  state: BatchState;
  answers: BatchAnswer[];
}

export const buildBatchBody = (displayName: string, requests: BatchRequest[]) => ({
  batch: {
    display_name: displayName,
    input_config: {
      requests: {
        requests: requests.map((r) => ({
          request: { contents: [{ role: "user", parts: [{ text: r.prompt }] }] },
          metadata: { key: r.key },
        })),
      },
    },
  },
});

/** "JOB_STATE_SUCCEEDED" / "BATCH_STATE_SUCCEEDED" → "succeeded". */
export const toBatchState = (raw: unknown): BatchState => {
  const s = String(raw ?? "");
  if (/SUCCEEDED/.test(s)) return "succeeded";
  if (/FAILED|CANCELLED|EXPIRED/.test(s)) return "failed";
  if (/RUNNING/.test(s)) return "running";
  return "pending";
};

/**
 * Read a batch as the API returns it. The inline answers have appeared under
 * both `response.inlinedResponses` and `response.inlinedResponses.inlinedResponses`,
 * and the state under `metadata.state` or `state`; all are accepted.
 */
export const readBatch = (body: any): BatchStatus => {
  const state = toBatchState(body?.metadata?.state ?? body?.state);
  const inlined = body?.response?.inlinedResponses;
  const items: any[] = Array.isArray(inlined) ? inlined : inlined?.inlinedResponses ?? [];
  const answers = items.map((item: any): BatchAnswer => {
    const parts = item?.response?.candidates?.[0]?.content?.parts ?? [];
    const text = parts.map((p: any) => p?.text ?? "").join("") || null;
    return {
      key: String(item?.metadata?.key ?? item?.key ?? ""),
      text,
      usage: item?.response?.usageMetadata ?? null,
      error: item?.error ? String(item.error.message ?? JSON.stringify(item.error)) : null,
    };
  });
  // A job can report success before its answers are attached; treat that as
  // still running rather than as a success with nothing in it.
  return { state: state === "succeeded" && !answers.length ? "running" : state, answers };
};

/** Submit a batch; returns its name ("batches/…"). */
export const submitBatch = async (
  apiKey: string,
  model: string,
  displayName: string,
  requests: BatchRequest[],
): Promise<string> => {
  const res = await axios.post(
    `${BASE}/models/${model}:batchGenerateContent`,
    buildBatchBody(displayName, requests),
    { headers: { "x-goog-api-key": apiKey, "Content-Type": "application/json" }, timeout: 60_000 },
  );
  const name = res.data?.name ?? res.data?.metadata?.name;
  if (!name) throw new Error("Batch API returned no job name");
  return String(name);
};

export const getBatch = async (apiKey: string, name: string): Promise<BatchStatus> => {
  const res = await axios.get(`${BASE}/${name}`, {
    headers: { "x-goog-api-key": apiKey },
    timeout: 60_000,
  });
  return readBatch(res.data);
};
