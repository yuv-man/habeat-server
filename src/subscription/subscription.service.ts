import { Injectable, BadRequestException, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Stripe from 'stripe';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { IUserData } from '../types/interfaces';
import { SubscriptionTier, SUBSCRIPTION_PRICES } from '../enums/enumSubscription';

@Injectable()
export class SubscriptionService {
  private stripe: Stripe;

  constructor(
    private configService: ConfigService,
    @InjectModel('User') private userModel: Model<IUserData>,
  ) {
    const stripeSecretKey = this.configService.get<string>('STRIPE_SECRET_KEY');
    if (!stripeSecretKey) {
      throw new Error('STRIPE_SECRET_KEY is not defined in environment variables');
    }
    this.stripe = new Stripe(stripeSecretKey, {
      apiVersion: '2026-01-28.clover',
    });
  }

  /**
   * Create a Stripe customer for a user
   */
  async createCustomer(userId: string, email: string, name?: string): Promise<string> {
    const customer = await this.stripe.customers.create({
      email,
      name,
      metadata: {
        userId,
      },
    });

    // Update user with Stripe customer ID
    await this.userModel.findByIdAndUpdate(userId, {
      stripeCustomerId: customer.id,
    });

    return customer.id;
  }

  /**
   * Create a checkout session for subscription
   */
  async createCheckoutSession(
    userId: string,
    tier: SubscriptionTier,
    successUrl: string,
    cancelUrl: string,
  ): Promise<string> {
    if (tier === SubscriptionTier.FREE) {
      throw new BadRequestException('Cannot create checkout session for free tier');
    }

    const user = await this.userModel.findById(userId);
    if (!user) {
      throw new NotFoundException('User not found');
    }

    // Create customer if doesn't exist
    let customerId = user.stripeCustomerId;
    if (!customerId) {
      customerId = await this.createCustomer(userId, user.email, user.name);
    }

    // Get or create price ID for the tier
    const priceId = await this.getOrCreatePrice(tier);

    const session = await this.stripe.checkout.sessions.create({
      customer: customerId,
      mode: 'subscription',
      payment_method_types: ['card'],
      line_items: [
        {
          price: priceId,
          quantity: 1,
        },
      ],
      success_url: successUrl,
      cancel_url: cancelUrl,
      metadata: {
        userId,
        tier,
      },
      subscription_data: {
        metadata: {
          userId,
          tier,
        },
      },
    });

    return session.url;
  }

  /**
   * Create a billing portal session for managing subscription
   */
  async createPortalSession(userId: string, returnUrl: string): Promise<string> {
    const user = await this.userModel.findById(userId);
    if (!user || !user.stripeCustomerId) {
      throw new BadRequestException('User does not have a Stripe customer ID');
    }

    const session = await this.stripe.billingPortal.sessions.create({
      customer: user.stripeCustomerId,
      return_url: returnUrl,
    });

    return session.url;
  }

  /**
   * Get or create a Stripe price for a subscription tier
   */
  private async getOrCreatePrice(tier: SubscriptionTier): Promise<string> {
    const priceAmount = SUBSCRIPTION_PRICES[tier];
    
    // Try to find existing price
    const prices = await this.stripe.prices.list({
      active: true,
      limit: 100,
    });

    const existingPrice = prices.data.find(
      (price) =>
        price.unit_amount === Math.round(priceAmount * 100) &&
        price.recurring?.interval === 'month' &&
        price.metadata?.tier === tier,
    );

    if (existingPrice) {
      return existingPrice.id;
    }

    // Create new product and price
    const product = await this.stripe.products.create({
      name: `Habeat ${tier.charAt(0).toUpperCase() + tier.slice(1)}`,
      metadata: {
        tier,
      },
    });

    const price = await this.stripe.prices.create({
      product: product.id,
      unit_amount: Math.round(priceAmount * 100), // Convert to cents
      currency: 'usd',
      recurring: {
        interval: 'month',
      },
      metadata: {
        tier,
      },
    });

    return price.id;
  }

  /**
   * Handle subscription created/updated webhook
   */
  async handleSubscriptionUpdate(subscription: Stripe.Subscription): Promise<void> {
    const userId = subscription.metadata.userId;
    const tier = subscription.metadata.tier as SubscriptionTier;

    if (!userId) {
      console.error('No userId in subscription metadata');
      return;
    }

    const updateData: any = {
      subscriptionTier: tier,
      stripeSubscriptionId: subscription.id,
      subscriptionStatus: subscription.status,
    };

    // Set subscription end date if exists
    // Note: Using type assertion as current_period_end exists in runtime but may not be in type definitions
    const subscriptionAny = subscription as any;
    if (subscriptionAny.current_period_end) {
      updateData.subscriptionEndDate = new Date(subscriptionAny.current_period_end * 1000);
    }

    await this.userModel.findByIdAndUpdate(userId, updateData);
  }

  /**
   * Handle subscription deleted webhook
   */
  async handleSubscriptionDeleted(subscription: Stripe.Subscription): Promise<void> {
    const userId = subscription.metadata.userId;

    if (!userId) {
      console.error('No userId in subscription metadata');
      return;
    }

    await this.userModel.findByIdAndUpdate(userId, {
      subscriptionTier: SubscriptionTier.FREE,
      subscriptionStatus: 'canceled',
      subscriptionEndDate: null,
    });
  }

  /**
   * Handle payment failed webhook
   */
  async handlePaymentFailed(invoice: Stripe.Invoice): Promise<void> {
    const customerId = invoice.customer as string;
    
    const user = await this.userModel.findOne({ stripeCustomerId: customerId });
    if (!user) {
      console.error('User not found for customer:', customerId);
      return;
    }

    await this.userModel.findByIdAndUpdate(user._id, {
      subscriptionStatus: 'past_due',
    });

    // TODO: Send notification to user about failed payment
  }

  /**
   * Cancel subscription
   */
  async cancelSubscription(userId: string): Promise<void> {
    const user = await this.userModel.findById(userId);
    if (!user || !user.stripeSubscriptionId) {
      throw new BadRequestException('User does not have an active subscription');
    }

    await this.stripe.subscriptions.cancel(user.stripeSubscriptionId);
  }

  /**
   * Get subscription details
   */
  async getSubscriptionDetails(userId: string): Promise<any> {
    const user = await this.userModel.findById(userId);
    if (!user || !user.stripeSubscriptionId) {
      return {
        tier: user?.subscriptionTier || SubscriptionTier.FREE,
        status: 'none',
      };
    }

    const subscription = await this.stripe.subscriptions.retrieve(user.stripeSubscriptionId);
    
    // Note: Using type assertion as current_period_end exists in runtime but may not be in type definitions
    const subscriptionAny = subscription as any;

    return {
      tier: user.subscriptionTier,
      status: subscription.status,
      currentPeriodEnd: subscriptionAny.current_period_end 
        ? new Date(subscriptionAny.current_period_end * 1000) 
        : null,
      cancelAtPeriodEnd: subscription.cancel_at_period_end,
    };
  }

  /**
   * Upgrade/downgrade subscription
   */
  async changeSubscription(userId: string, newTier: SubscriptionTier): Promise<void> {
    if (newTier === SubscriptionTier.FREE) {
      await this.cancelSubscription(userId);
      return;
    }

    const user = await this.userModel.findById(userId);
    if (!user || !user.stripeSubscriptionId) {
      throw new BadRequestException('User does not have an active subscription');
    }

    const subscription = await this.stripe.subscriptions.retrieve(user.stripeSubscriptionId);
    const newPriceId = await this.getOrCreatePrice(newTier);

    await this.stripe.subscriptions.update(user.stripeSubscriptionId, {
      items: [
        {
          id: subscription.items.data[0].id,
          price: newPriceId,
        },
      ],
      proration_behavior: 'create_prorations',
      metadata: {
        userId,
        tier: newTier,
      },
    });

    await this.userModel.findByIdAndUpdate(userId, {
      subscriptionTier: newTier,
    });
  }
}
