import { Injectable, OnModuleDestroy } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { PostHog } from "posthog-node";
import logger from "../utils/logger";

@Injectable()
export class AnalyticsService implements OnModuleDestroy {
  private client: PostHog | null = null;

  constructor(private configService: ConfigService) {
    const apiKey = this.configService.get<string>("POSTHOG_API_KEY");
    if (apiKey) {
      this.client = new PostHog(apiKey, {
        host: "https://app.posthog.com",
        flushAt: 20,
        flushInterval: 10000,
      });
    } else {
      logger.warn("[Analytics] POSTHOG_API_KEY not set — analytics disabled");
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
