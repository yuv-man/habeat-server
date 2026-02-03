import {
  Controller,
  Post,
  Get,
  Body,
  UseGuards,
  Request,
  Headers,
  BadRequestException,
} from '@nestjs/common';
import { SubscriptionService } from './subscription.service';
import { AuthGuard } from '../auth/auth.guard';
import { ConfigService } from '@nestjs/config';
import Stripe from 'stripe';
import { CreateCheckoutSessionDto } from './dto/create-checkout-session.dto';
import { CreatePortalSessionDto } from './dto/create-portal-session.dto';
import { ChangeTierDto } from './dto/change-tier.dto';

@Controller('subscription')
export class SubscriptionController {
  private stripe: Stripe;
  private webhookSecret: string;

  constructor(
    private subscriptionService: SubscriptionService,
    private configService: ConfigService,
  ) {
    const stripeSecretKey = this.configService.get<string>('STRIPE_SECRET_KEY');
    this.webhookSecret = this.configService.get<string>('STRIPE_WEBHOOK_SECRET') || '';
    
    if (!stripeSecretKey) {
      throw new Error('STRIPE_SECRET_KEY is not defined in environment variables');
    }
    
    this.stripe = new Stripe(stripeSecretKey, {
      apiVersion: '2026-01-28.clover',
    });
  }

  /**
   * Create a checkout session for a subscription
   */
  @Post('create-checkout-session')
  @UseGuards(AuthGuard)
  async createCheckoutSession(
    @Request() req: any,
    @Body() body: CreateCheckoutSessionDto,
  ) {
    const userId = req.user.userId;
    const { tier, successUrl, cancelUrl } = body;

    const checkoutUrl = await this.subscriptionService.createCheckoutSession(
      userId,
      tier,
      successUrl,
      cancelUrl,
    );

    return { url: checkoutUrl };
  }

  /**
   * Create a billing portal session
   */
  @Post('create-portal-session')
  @UseGuards(AuthGuard)
  async createPortalSession(@Request() req: any, @Body() body: CreatePortalSessionDto) {
    const userId = req.user.userId;
    const { returnUrl } = body;

    const portalUrl = await this.subscriptionService.createPortalSession(userId, returnUrl);

    return { url: portalUrl };
  }

  /**
   * Get subscription details
   */
  @Get('details')
  @UseGuards(AuthGuard)
  async getSubscriptionDetails(@Request() req: any) {
    const userId = req.user.userId;
    return this.subscriptionService.getSubscriptionDetails(userId);
  }

  /**
   * Cancel subscription
   */
  @Post('cancel')
  @UseGuards(AuthGuard)
  async cancelSubscription(@Request() req: any) {
    const userId = req.user.userId;
    await this.subscriptionService.cancelSubscription(userId);
    return { message: 'Subscription canceled successfully' };
  }

  /**
   * Change subscription tier
   */
  @Post('change-tier')
  @UseGuards(AuthGuard)
  async changeSubscription(@Request() req: any, @Body() body: ChangeTierDto) {
    const userId = req.user.userId;
    const { tier } = body;

    await this.subscriptionService.changeSubscription(userId, tier);
    return { message: 'Subscription updated successfully' };
  }

  /**
   * Stripe webhook handler
   * This endpoint receives events from Stripe
   */
  @Post('webhook')
  async handleWebhook(@Request() req: any, @Headers('stripe-signature') signature: string) {
    if (!signature) {
      throw new BadRequestException('Missing stripe-signature header');
    }

    let event: Stripe.Event;

    try {
      // Get raw body from request
      const rawBody = req.body;
      
      // Verify webhook signature
      event = this.stripe.webhooks.constructEvent(
        rawBody,
        signature,
        this.webhookSecret,
      );
    } catch (err) {
      console.error('Webhook signature verification failed:', err.message);
      throw new BadRequestException(`Webhook Error: ${err.message}`);
    }

    // Handle the event
    try {
      switch (event.type) {
        case 'customer.subscription.created':
        case 'customer.subscription.updated':
          const subscription = event.data.object as Stripe.Subscription;
          await this.subscriptionService.handleSubscriptionUpdate(subscription);
          break;

        case 'customer.subscription.deleted':
          const deletedSubscription = event.data.object as Stripe.Subscription;
          await this.subscriptionService.handleSubscriptionDeleted(deletedSubscription);
          break;

        case 'invoice.payment_failed':
          const invoice = event.data.object as Stripe.Invoice;
          await this.subscriptionService.handlePaymentFailed(invoice);
          break;

        case 'invoice.payment_succeeded':
          // Payment succeeded - subscription is active
          console.log('Payment succeeded for invoice:', event.data.object.id);
          break;

        default:
          console.log(`Unhandled event type: ${event.type}`);
      }

      return { received: true };
    } catch (err) {
      console.error('Error handling webhook event:', err);
      throw new BadRequestException('Error processing webhook');
    }
  }
}
