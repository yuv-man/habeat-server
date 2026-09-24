const PostHogMock = jest.fn().mockImplementation(() => ({ capture: jest.fn(), identify: jest.fn(), shutdown: jest.fn() }));
jest.mock("posthog-node", () => ({ PostHog: PostHogMock }));

import { AnalyticsService } from "../../../src/analytics/analytics.service";

const config = (values: Record<string, string | undefined>) =>
  ({ get: (key: string) => values[key] }) as any;

describe("AnalyticsService", () => {
  beforeEach(() => PostHogMock.mockClear());

  it("sends to PostHog EU with a project key", () => {
    new AnalyticsService(config({ POSTHOG_API_KEY: "phc_project" }));
    expect(PostHogMock).toHaveBeenCalledWith(
      "phc_project",
      expect.objectContaining({ host: "https://eu.i.posthog.com" }),
    );
  });

  it("uses POSTHOG_HOST when set", () => {
    new AnalyticsService(config({ POSTHOG_API_KEY: "phc_project", POSTHOG_HOST: "https://us.i.posthog.com" }));
    expect(PostHogMock).toHaveBeenCalledWith("phc_project", expect.objectContaining({ host: "https://us.i.posthog.com" }));
  });

  it("refuses a personal API key", () => {
    const service = new AnalyticsService(config({ POSTHOG_API_KEY: "phx_personal" }));
    expect(PostHogMock).not.toHaveBeenCalled();
    expect(() => service.capture("u1", "event")).not.toThrow();
  });

  it("stays off without a key", () => {
    new AnalyticsService(config({}));
    expect(PostHogMock).not.toHaveBeenCalled();
  });
});
