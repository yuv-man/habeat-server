import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Browser, Page, chromium } from 'playwright';
import logger from '../../utils/logger';

/**
 * How much of the cleaned page markup is sent to the model. The raw
 * `page.content()` of a React app is mostly scripts and inline SVG, so it is
 * stripped first — this budget is spent on things the user can actually see.
 */
const HTML_BUDGET = 12000;

@Injectable()
export class BrowserService {
  private browser: Browser | null = null;
  private page: Page | null = null;
  private readonly baseUrl: string;
  private readonly headless: boolean;
  private readonly slowMo: number;

  constructor(private readonly config: ConfigService) {
    this.baseUrl = this.config.get<string>('HABEAT_URL') ?? 'http://localhost:8080';
    // AI_AGENT_HEADFUL=true opens a visible browser so you can watch the session.
    this.headless = this.config.get<string>('AI_AGENT_HEADFUL') !== 'true';
    this.slowMo = Number(this.config.get<string>('AI_AGENT_SLOWMO') ?? 0);
  }

  async start(): Promise<void> {
    if (this.browser) return;
    logger.info(`[BrowserService] Launching Chromium (headless=${this.headless})...`);
    this.browser = await chromium.launch({ headless: this.headless, slowMo: this.slowMo });
    const context = await this.browser.newContext({
      viewport: { width: 1280, height: 900 },
      locale: 'en-US',
    });
    this.page = await context.newPage();
    logger.info('[BrowserService] Browser started.');
  }

  async stop(): Promise<void> {
    if (this.browser) {
      await this.browser.close();
      this.browser = null;
      this.page = null;
      logger.info('[BrowserService] Browser stopped.');
    }
  }

  async navigate(url: string): Promise<void> {
    if (!this.page) throw new Error('Browser not started');
    logger.info(`[BrowserService] Navigating to ${url}`);
    await this.page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await this.settle();
  }

  async navigateToApp(): Promise<void> {
    await this.navigate(this.baseUrl);
  }

  /**
   * Logs in through the real UI.
   *
   * On the Habeat landing page the login form lives inside an AuthModal that
   * only mounts once "Sign In" is clicked — filling inputs before that fails.
   */
  async login(email: string, password: string): Promise<void> {
    const page = this.requirePage();
    logger.info(`[BrowserService] Logging in as ${email}`);
    await this.navigateToApp();

    // Already authenticated (session restored) — nothing to do.
    if (page.url().includes('/daily-tracker')) {
      logger.info('[BrowserService] Already logged in.');
      return;
    }

    const emailInput = page.locator('input[type="email"]').first();
    if (!(await emailInput.isVisible().catch(() => false))) {
      // Open the auth modal. The desktop hero uses a plain div, so match on text.
      const signIn = page.getByText('Sign In', { exact: false }).first();
      await signIn.click({ timeout: 10000 });
      await emailInput.waitFor({ state: 'visible', timeout: 10000 });
    }

    await emailInput.fill(email);
    await page.locator('input[type="password"]').first().fill(password);
    await page.locator('button[type="submit"]').first().click();

    await page
      .waitForURL(/daily-tracker|register|weekly-overview/, { timeout: 20000 })
      .catch(() => logger.warn('[BrowserService] No redirect after login — continuing anyway.'));
    await this.settle();
    logger.info(`[BrowserService] Login finished at ${page.url()}`);
  }

  /**
   * The page as the model sees it: current URL plus markup with scripts,
   * styles, SVG paths and data-URIs removed.
   */
  async getState(): Promise<{ url: string; html: string }> {
    const page = this.requirePage();
    const url = page.url();

    const html = await page
      .evaluate(() => {
        const root = document.body.cloneNode(true) as HTMLElement;
        root
          .querySelectorAll('script, style, noscript, link, svg, path, iframe')
          .forEach((el) => el.remove());
        root.querySelectorAll('*').forEach((el) => {
          // Drop attributes that burn tokens without helping the model click.
          ['class', 'style', 'srcset', 'sizes', 'loading', 'width', 'height'].forEach((a) =>
            el.removeAttribute(a),
          );
          const src = el.getAttribute('src');
          if (src?.startsWith('data:')) el.setAttribute('src', '[image]');
        });
        return root.innerHTML.replace(/<!--[\s\S]*?-->/g, '').replace(/\s{2,}/g, ' ').trim();
      })
      .catch(async () => (await page.content()).slice(0, HTML_BUDGET));

    return { url, html: html.slice(0, HTML_BUDGET) };
  }

  async screenshot(): Promise<Buffer> {
    return this.requirePage().screenshot({ fullPage: false });
  }

  /** Click by visible text — how a person picks a button. */
  async clickText(text: string): Promise<boolean> {
    const page = this.requirePage();
    // A CSS selector was passed by mistake; let click() handle it.
    if (/^[#.[]|^[a-z]+\[/.test(text)) return false;
    try {
      const byRole = page.getByRole('button', { name: text, exact: false }).first();
      const target = (await byRole.count()) ? byRole : page.getByText(text, { exact: false }).first();
      await target.click({ timeout: 5000 });
      await this.settle();
      return true;
    } catch (err) {
      logger.warn(`[BrowserService] Click text failed for "${text}": ${(err as Error).message}`);
      return false;
    }
  }

  async click(selector: string): Promise<boolean> {
    const page = this.requirePage();
    try {
      await page.locator(selector).first().click({ timeout: 5000 });
      await this.settle();
      return true;
    } catch (err) {
      logger.warn(`[BrowserService] Click failed for "${selector}": ${(err as Error).message}`);
      return false;
    }
  }

  async type(selector: string, value: string): Promise<boolean> {
    const page = this.requirePage();
    const candidates = [
      () => page.locator(selector).first(),
      () => page.getByPlaceholder(selector, { exact: false }).first(),
      () => page.getByLabel(selector, { exact: false }).first(),
    ];
    for (const build of candidates) {
      try {
        await build().fill(value, { timeout: 3000 });
        return true;
      } catch {
        /* try the next strategy */
      }
    }
    logger.warn(`[BrowserService] Type failed for "${selector}"`);
    return false;
  }

  async scroll(amount: number): Promise<boolean> {
    const page = this.requirePage();
    try {
      await page.evaluate((px) => window.scrollBy(0, px), amount);
      await page.waitForTimeout(300);
      return true;
    } catch (err) {
      logger.warn(`[BrowserService] Scroll failed: ${(err as Error).message}`);
      return false;
    }
  }

  async goBack(): Promise<boolean> {
    const page = this.requirePage();
    try {
      await page.goBack({ waitUntil: 'domcontentloaded', timeout: 10000 });
      await this.settle();
      return true;
    } catch (err) {
      logger.warn(`[BrowserService] Go back failed: ${(err as Error).message}`);
      return false;
    }
  }

  async wait(milliseconds: number): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, milliseconds));
  }

  /** Let the SPA finish rendering, without failing the action if it never idles. */
  private async settle(): Promise<void> {
    if (!this.page) return;
    await this.page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => {});
    await this.page.waitForTimeout(300);
  }

  private requirePage(): Page {
    if (!this.page) throw new Error('Browser not started');
    return this.page;
  }
}
