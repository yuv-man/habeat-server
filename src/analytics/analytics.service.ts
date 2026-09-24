import { Injectable, OnModuleDestroy } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { PostHog } from "posthog-node";
import logger from "../utils/logger";

@Injectable()
export class AnalyticsService implements OnModuleDestroy {
  private client: PostHog | null = null;

  constructor(private configService: ConfigService) {
    const apiKey = this.configService.get<string>("POSTHOG_API_KEY")?.trim();
    if (!apiKey) {
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
    if (!this.client) return;
    try {
      this.client.capture({ distinctId, event, properties });
    } catch (err) {
      logger.warn(`[Analytics] Failed to capture event "${event}": ${err}`);
    }
  }

  identify(distinctId: string, properties: Record<string, unknown> = {}) {
    if (!this.client) return;
    try {
      this.client.identify({ distinctId, properties });
    } catch (err) {
      logger.warn(`[Analytics] Failed to identify user: ${err}`);
    }
  }

  async onModuleDestroy() {
    await this.client?.shutdown();
  }
}
