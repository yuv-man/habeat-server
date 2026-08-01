import { parseMultiDayResponse } from "../../../src/generator/generate.service";

const day = (date: string) => ({
  date,
  day: "monday",
  meals: { breakfast: { name: "Oats" }, lunch: {}, dinner: {}, snacks: [] },
  workouts: [],
});

describe("parseMultiDayResponse", () => {
  it("parses a clean array", () => {
    expect(parseMultiDayResponse(JSON.stringify([day("2026-08-03")]))).toHaveLength(1);
  });

  it("recovers a valid array with trailing junk after it", () => {
    // Observed in a real generation: a complete week followed by a stray token,
    // which threw "Unexpected non-whitespace character after JSON" and binned
    // the entire batch.
    const body = JSON.stringify([day("2026-08-03"), day("2026-08-04")]);
    expect(parseMultiDayResponse(`${body}\n\n]`)).toHaveLength(2);
    expect(parseMultiDayResponse(`${body} Note: enjoy!`)).toHaveLength(2);
  });

  it("recovers from a markdown fence", () => {
    const body = JSON.stringify([day("2026-08-03")]);
    expect(parseMultiDayResponse("```json\n" + body + "\n```")).toHaveLength(1);
  });

  it("is not fooled by brackets inside string values", () => {
    const tricky = [{ ...day("2026-08-03"), note: 'has ] and } inside "quotes"' }];
    expect(parseMultiDayResponse(JSON.stringify(tricky) + " trailing")).toHaveLength(1);
  });

  it("unwraps the object-with-weeklyPlan shape", () => {
    const wrapped = JSON.stringify({ weeklyPlan: [day("2026-08-03")] });
    expect(parseMultiDayResponse(wrapped)).toHaveLength(1);
  });

  it("accepts a bare single day", () => {
    expect(parseMultiDayResponse(JSON.stringify(day("2026-08-03")))).toHaveLength(1);
  });

  it("still throws on genuinely truncated output", () => {
    // Half a day is not silently turned into a plan.
    expect(() => parseMultiDayResponse('[{"date":"2026-08-03","meals":{"break')).toThrow();
  });
});
