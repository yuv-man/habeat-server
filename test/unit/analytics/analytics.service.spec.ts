const posthogCapture = jest.fn();
const posthogIdentify = jest.fn();
const PostHogMock = jest
  .fn()
  .mockImplementation(() => ({ capture: posthogCapture, identify: posthogIdentify, shutdown: jest.fn() }));
jest.mock("posthog-node", () => ({ PostHog: PostHogMock }));

import { AnalyticsService } from "../../../src/analytics/analytics.service";
import { isTestAccountEmail } from "../../../src/utils/test-accounts";

const config = (values: Record<string, string | undefined>) =>
  ({ get: (key: string) => values[key] }) as any;

describe("AnalyticsService", () => {
  beforeEach(() => {
    PostHogMock.mockClear();
    posthogCapture.mockClear();
    posthogIdentify.mockClear();
  });

  const prod = { NODE_ENV: "production" };

  it("sends to PostHog EU with a project key", () => {
    new AnalyticsService(config({ ...prod, POSTHOG_API_KEY: "phc_project" }));
    expect(PostHogMock).toHaveBeenCalledWith(
      "phc_project",
      expect.objectContaining({ host: "https://eu.i.posthog.com" }),
    );
  });

  it("uses POSTHOG_HOST when set", () => {
    new AnalyticsService(config({ ...prod, POSTHOG_API_KEY: "phc_project", POSTHOG_HOST: "https://us.i.posthog.com" }));
    expect(PostHogMock).toHaveBeenCalledWith("phc_project", expect.objectContaining({ host: "https://us.i.posthog.com" }));
  });

  it("refuses a personal API key", () => {
    const service = new AnalyticsService(config({ ...prod, POSTHOG_API_KEY: "phx_personal" }));
    expect(PostHogMock).not.toHaveBeenCalled();
    expect(() => service.capture("u1", "event")).not.toThrow();
  });

  it("stays off without a key", () => {
    new AnalyticsService(config({ ...prod }));
    expect(PostHogMock).not.toHaveBeenCalled();
  });

  it("never sends from development, even with a valid key", () => {
    // A key in a developer's .env used to make every local run count as a
    // real user in production analytics.
    const service = new AnalyticsService(config({ NODE_ENV: "development", POSTHOG_API_KEY: "phc_project" }));
    service.capture("u1", "meal_swapped", { via: "my_meals" });
    expect(PostHogMock).not.toHaveBeenCalled();
  });

  it("logs events locally outside production, so they can be checked", () => {
    const logger = require("../../../src/utils/logger").default;
    const spy = jest.spyOn(logger, "info").mockImplementation(() => logger);
    const service = new AnalyticsService(config({ POSTHOG_API_KEY: "phc_project" }));
    service.capture("u1", "meal_help_offered", { option_count: 2 });
    expect(spy).toHaveBeenCalledWith('[Analytics:dev] meal_help_offered {"option_count":2}');
    spy.mockRestore();
  });

  it("can be switched on outside production on purpose", () => {
    new AnalyticsService(config({ NODE_ENV: "staging", ANALYTICS_ENABLED: "true", POSTHOG_API_KEY: "phc_project" }));
    expect(PostHogMock).toHaveBeenCalled();
  });

  describe("test accounts", () => {
    const realId = "a".repeat(24);
    const testId = "b".repeat(24);
    const emails: Record<string, string> = { [realId]: "jo@gmail.com", [testId]: "qa1@example.com" };
    const findById = jest.fn((id: string) => ({
      select: () => ({ lean: () => Promise.resolve({ email: emails[id] }) }),
    }));
    const live = () =>
      new AnalyticsService(config({ ...prod, POSTHOG_API_KEY: "phc_project" }), { findById } as any);
    const flush = () => new Promise((resolve) => setImmediate(resolve));

    beforeEach(() => findById.mockClear());

    it("recognises the reserved example domains only", () => {
      expect(isTestAccountEmail("qa@example.com")).toBe(true);
      expect(isTestAccountEmail("QA@Example.org ")).toBe(true);
      expect(isTestAccountEmail("me@example.co")).toBe(false);
      expect(isTestAccountEmail("me@myexample.com")).toBe(false);
      expect(isTestAccountEmail(undefined)).toBe(false);
    });

    it("drops events from @example.com accounts and sends the rest", async () => {
      const service = live();
      service.capture(testId, "meal_swapped");
      service.capture(realId, "meal_swapped");
      await flush();
      expect(posthogCapture).toHaveBeenCalledTimes(1);
      expect(posthogCapture).toHaveBeenCalledWith(expect.objectContaining({ distinctId: realId }));
    });

    it("looks each user up once", async () => {
      const service = live();
      service.capture(testId, "a");
      await flush();
      service.capture(testId, "b");
      await flush();
      expect(findById).toHaveBeenCalledTimes(1);
    });

    it("skips identify for a test signup without a lookup", async () => {
      const service = live();
      service.identify(testId, { email: "qa1@example.com" });
      service.capture(testId, "user_signed_up");
      await flush();
      expect(posthogIdentify).not.toHaveBeenCalled();
      expect(posthogCapture).not.toHaveBeenCalled();
      expect(findById).not.toHaveBeenCalled();
    });
  });
});
