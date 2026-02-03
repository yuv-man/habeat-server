# Stripe Subscription Integration - Quick Start

## 🚀 Quick Setup (5 minutes)

### 1. Get Stripe Keys

1. Sign up at [stripe.com](https://stripe.com)
2. Go to [Dashboard → API Keys](https://dashboard.stripe.com/apikeys)
3. Copy your **Secret key** (starts with `sk_test_`)

### 2. Update Environment Variables

Add to your `.env` file:

```env
STRIPE_SECRET_KEY=sk_test_your_actual_key_here
STRIPE_WEBHOOK_SECRET=whsec_your_webhook_secret_here
```

### 3. Set Up Webhooks (Local Development)

```bash
# Install Stripe CLI
brew install stripe/stripe-cli/stripe

# Login
stripe login

# Forward webhooks to local server
stripe listen --forward-to localhost:5080/api/subscription/webhook

# Copy the webhook secret (whsec_...) to your .env file
```

### 4. Start Your Server

```bash
npm run start:dev
```

### 5. Test with Stripe Test Card

- Card Number: `4242 4242 4242 4242`
- Expiry: Any future date
- CVC: Any 3 digits
- ZIP: Any 5 digits

## 📋 API Endpoints

All endpoints require JWT authentication (except webhook):

### Create Checkout Session
```http
POST /api/subscription/create-checkout-session
Authorization: Bearer <token>
Content-Type: application/json

{
  "tier": "plus",
  "successUrl": "http://localhost:8080/success",
  "cancelUrl": "http://localhost:8080/cancel"
}
```

### Get Subscription Details
```http
GET /api/subscription/details
Authorization: Bearer <token>
```

### Manage Subscription (Billing Portal)
```http
POST /api/subscription/create-portal-session
Authorization: Bearer <token>
Content-Type: application/json

{
  "returnUrl": "http://localhost:8080/settings"
}
```

### Change Tier
```http
POST /api/subscription/change-tier
Authorization: Bearer <token>
Content-Type: application/json

{
  "tier": "premium"
}
```

### Cancel Subscription
```http
POST /api/subscription/cancel
Authorization: Bearer <token>
```

## 💰 Pricing Tiers

- **Free**: $0/month
- **Plus**: $9.99/month
- **Premium**: $14.99/month

## 📚 Full Documentation

- **Complete Setup Guide**: `STRIPE_SETUP.md`
- **Frontend Integration**: `FRONTEND_INTEGRATION.md`
- **Integration Summary**: `STRIPE_INTEGRATION_SUMMARY.md`

## 🔍 What Was Added

### New Files
- `src/subscription/` - Complete subscription module
  - `subscription.service.ts` - Business logic
  - `subscription.controller.ts` - API endpoints
  - `subscription.module.ts` - NestJS module
  - `dto/` - Data transfer objects

### Modified Files
- `src/user/user.model.ts` - Added Stripe fields
- `src/types/interfaces.ts` - Updated user interface
- `src/app.module.ts` - Registered subscription module
- `src/main.ts` - Configured webhook endpoint
- `.env` - Added Stripe configuration

### New Database Fields
```typescript
stripeCustomerId: string          // Stripe customer ID
stripeSubscriptionId: string      // Active subscription ID
subscriptionStatus: string        // active, canceled, past_due, etc.
subscriptionEndDate: Date         // Current period end
```

## 🧪 Testing

```bash
# Test checkout flow
curl -X POST http://localhost:5080/api/subscription/create-checkout-session \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "tier": "plus",
    "successUrl": "http://localhost:8080/success",
    "cancelUrl": "http://localhost:8080/cancel"
  }'

# Get subscription details
curl http://localhost:5080/api/subscription/details \
  -H "Authorization: Bearer YOUR_TOKEN"
```

## 🚨 Troubleshooting

**Webhook not working?**
- Ensure Stripe CLI is running: `stripe listen --forward-to localhost:5080/api/subscription/webhook`
- Check `STRIPE_WEBHOOK_SECRET` in `.env`
- Verify server is running on port 5080

**Build errors?**
- Run `npm install` to ensure all dependencies are installed
- Check that `stripe` and `@types/stripe` are installed

**Payment not updating user tier?**
- Check webhook events in Stripe Dashboard
- Verify `userId` is in subscription metadata
- Check server logs for errors

## 🎯 Next Steps

1. **Test the integration** with Stripe test cards
2. **Implement frontend** using `FRONTEND_INTEGRATION.md`
3. **Add email notifications** for payment events
4. **Set up production webhooks** when ready to go live

## 📞 Support

- Stripe Documentation: https://stripe.com/docs
- Stripe API Reference: https://stripe.com/docs/api
- Test Cards: https://stripe.com/docs/testing

---

**Ready to accept payments!** 🎉

Start by following the Quick Setup above, then refer to the detailed guides for more information.
