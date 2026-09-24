import { buildBatchBody, readBatch, toBatchState } from "../../../src/utils/gemini-batch";

describe("Gemini Batch API", () => {
  it("sends each prompt with its key", () => {
    const body = buildBatchBody("nightly", [{ key: "u1", prompt: "hello" }]);
    const req = body.batch.input_config.requests.requests[0];
    expect(req.metadata.key).toBe("u1");
    expect(req.request.contents[0].parts[0].text).toBe("hello");
    expect(body.batch.display_name).toBe("nightly");
  });

  it("reads every state spelling", () => {
    expect(toBatchState("JOB_STATE_SUCCEEDED")).toBe("succeeded");
    expect(toBatchState("BATCH_STATE_RUNNING")).toBe("running");
    expect(toBatchState("JOB_STATE_EXPIRED")).toBe("failed");
    expect(toBatchState(undefined)).toBe("pending");
  });

  it("reads answers, their keys and usage, in either nesting", () => {
    const answer = {
      metadata: { key: "u1" },
      response: {
        candidates: [{ content: { parts: [{ text: '{"keyPatterns":' }, { text: "[]}" }] } }],
        usageMetadata: { promptTokenCount: 5000, candidatesTokenCount: 900 },
      },
    };
    for (const inlined of [[answer], { inlinedResponses: [answer] }]) {
      const s = readBatch({ metadata: { state: "JOB_STATE_SUCCEEDED" }, response: { inlinedResponses: inlined } });
      expect(s.state).toBe("succeeded");
      expect(s.answers[0]).toEqual({
        key: "u1",
        text: '{"keyPatterns":[]}',
        usage: { promptTokenCount: 5000, candidatesTokenCount: 900 },
        error: null,
      });
    }
  });

  it("does not call a job done before its answers are there", () => {
    expect(readBatch({ state: "JOB_STATE_SUCCEEDED" }).state).toBe("running");
  });

  it("keeps a per-request error", () => {
    const s = readBatch({
      state: "JOB_STATE_SUCCEEDED",
      response: { inlinedResponses: [{ metadata: { key: "u2" }, error: { message: "quota" } }] },
    });
    expect(s.answers[0]).toMatchObject({ key: "u2", text: null, error: "quota" });
  });
});
