import { Injectable, OnModuleDestroy, Optional } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { InjectModel } from "@nestjs/mongoose";
import { Model } from "mongoose";
import { PostHog } from "posthog-node";
import logger from "../utils/logger";
import { isTestAccountEmail } from "../utils/test-accounts";
import { User } from "../user/user.model";

/** Cached test-account answers before the cache starts over. */
const TEST_ACCOUNT_CACHE_LIMIT = 5000;

/**
 * Product analytics, sent only from production.
 *
 * Development used to send to the live PostHog project whenever the key was in
 * .env — every local test run became "real users". Now events leave the
 * process only when NODE_ENV is "production" (set in the Dockerfile) or
 * ANALYTICS_ENABLED=true is set on purpose. Otherwise, outside production,
 * each event is written to the log instead, so new instrumentation can be
 * checked locally without touching real metrics.
 *
 * Test accounts (@example.com and the other reserved example domains) are
 * never sent, in production either. Events only carry a user id, so the
 * account's email is looked up once per user and remembered.
 */
@Injectable()
export class AnalyticsService implements OnModuleDestroy {
  private client: PostHog | null = null;
  private readonly logLocally: boolean;
  private readonly testAccounts = new Map<string, boolean>();

  constructor(
    private configService: ConfigService,
    @Optional() @InjectModel(User.name) private userModel?: Model<any>,
  ) {
    const apiKey = this.configService.get<string>("POSTHOG_API_KEY")?.trim();
    const isProduction = this.configService.get<string>("NODE_ENV") === "production";
    const forced = this.configService.get<string>("ANALYTICS_ENABLED") === "true";
    this.logLocally = !isProduction && !forced;
    if (this.logLocally) {
      logger.info("[Analytics] Not production — events are logged here, not sent to PostHog");
    } else if (!apiKey) {
      logger.warn("[Analytics] POSTHOG_API_KEY not set — analytics disabled");
    } else if (!apiKey.startsWith("phc_")) {
      // Capturing takes the project API key (phc_…). A personal API key
      // (phx_…) is an account login: PostHog rejects it for capture, and it
      // should not be sitting in an events client at all.
      logger.error(
        "[Analytics] POSTHOG_API_KEY is not a PostHog project key (phc_…) — analytics disabled",
      );
    } else {
      this.client = new PostHog(apiKey, {
        // The project lives on PostHog EU; app.posthog.com is the US cloud.
        host: this.configService.get<string>("POSTHOG_HOST") || "https://eu.i.posthog.com",
        flushAt: 20,
        flushInterval: 10000,
      });
    }
  }

  capture(distinctId: string, event: string, properties: Record<string, unknown> = {}) {
    if (this.logLocally) {
      logger.info(`[Analytics:dev] ${event} ${JSON.stringify(properties)}`);
      return;
    }
    const client = this.client;
    if (!client) return;
    void this.isTestAccount(distinctId).then((isTest) => {
      if (isTest) return;
      try {
        client.capture({ distinctId, event, properties });
      } catch (err) {
        logger.warn(`[Analytics] Failed to capture event "${event}": ${err}`);
      }
    });
  }

  identify(distinctId: string, properties: Record<string, unknown> = {}) {
    if (!this.client) return;
    if (typeof properties.email === "string") {
      this.remember(distinctId, isTestAccountEmail(properties.email));
    }
    if (this.testAccounts.get(distinctId)) return;
    try {
      this.client.identify({ distinctId, properties });
    } catch (err) {
      logger.warn(`[Analytics] Failed to identify user: ${err}`);
    }
  }

  /** Whether the user behind an event is a test account. Unknown ids
   *  ("anonymous") and failed lookups count as real users. */
  async isTestAccount(distinctId: string): Promise<boolean> {
    const known = this.testAccounts.get(distinctId);
    if (known !== undefined) return known;
    if (!this.userModel || !/^[0-9a-f]{24}$/i.test(distinctId)) return false;
    try {
      const user = await this.userModel.findById(distinctId).select("email").lean<{ email?: string }>();
      return this.remember(distinctId, isTestAccountEmail(user?.email));
    } catch (err) {
      logger.warn(`[Analytics] Test-account lookup failed: ${err}`);
      return false;
    }
  }

  private remember(distinctId: string, isTest: boolean): boolean {
    if (this.testAccounts.size >= TEST_ACCOUNT_CACHE_LIMIT) this.testAccounts.clear();
    this.testAccounts.set(distinctId, isTest);
    return isTest;
  }

  async onModuleDestroy() {
    await this.client?.shutdown();
  }
}
