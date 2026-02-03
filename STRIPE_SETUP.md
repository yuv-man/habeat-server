# Stripe Subscription Integration Setup

This guide will help you set up Stripe for subscription payments in Habeat.

## 1. Create a Stripe Account

1. Go to [https://stripe.com](https://stripe.com) and sign up
2. Complete your account setup
3. You'll start in **Test Mode** (recommended for development)

## 2. Get Your API Keys

1. Go to [https://dashboard.stripe.com/apikeys](https://dashboard.stripe.com/apikeys)
2. Copy your **Secret key** (starts with `sk_test_...` in test mode)
3. Add it to your `.env` file:

```env
STRIPE_SECRET_KEY=sk_test_your_actual_key_here
```

## 3. Set Up Webhook Endpoint

Webhooks allow Stripe to notify your server about payment events (successful payments, failed payments, subscription cancellations, etc.).

### For Local Development (using Stripe CLI)

1. Install Stripe CLI: [https://stripe.com/docs/stripe-cli](https://stripe.com/docs/stripe-cli)

2. Login to Stripe CLI:
```bash
stripe login
```

3. Forward webhooks to your local server:
```bash
stripe listen --forward-to localhost:5080/api/subscription/webhook
```

4. Copy the webhook signing secret (starts with `whsec_...`) and add to `.env`:
```env
STRIPE_WEBHOOK_SECRET=whsec_your_webhook_secret_here
```

### For Production

1. Go to [https://dashboard.stripe.com/webhooks](https://dashboard.stripe.com/webhooks)
2. Click **Add endpoint**
3. Enter your production URL: `https://your-domain.com/api/subscription/webhook`
4. Select events to listen to:
   - `customer.subscription.created`
   - `customer.subscription.updated`
   - `customer.subscription.deleted`
   - `invoice.payment_succeeded`
   - `invoice.payment_failed`
5. Copy the **Signing secret** and add to your production `.env`

## 4. Test the Integration

### Start Your Server
```bash
npm run start:dev
```

### Test Subscription Flow

1. **Create a checkout session** (replace `USER_TOKEN` with a valid JWT):
```bash
curl -X POST http://localhost:5080/api/subscription/create-checkout-session \
  -H "Authorization: Bearer USER_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "tier": "plus",
    "successUrl": "http://localhost:8080/subscription/success",
    "cancelUrl": "http://localhost:8080/subscription/cancel"
  }'
```

2. Open the returned URL in a browser
3. Use Stripe test card: `4242 4242 4242 4242`
   - Any future expiry date
   - Any 3-digit CVC
   - Any ZIP code

### Test Cards

Stripe provides test cards for different scenarios:

- **Success**: `4242 4242 4242 4242`
- **Decline**: `4000 0000 0000 0002`
- **Insufficient funds**: `4000 0000 0000 9995`
- **3D Secure required**: `4000 0025 0000 3155`

More test cards: [https://stripe.com/docs/testing](https://stripe.com/docs/testing)

## 5. API Endpoints

### Create Checkout Session
```http
POST /api/subscription/create-checkout-session
Authorization: Bearer <token>
Content-Type: application/json

{
  "tier": "plus" | "premium",
  "successUrl": "https://your-app.com/success",
  "cancelUrl": "https://your-app.com/cancel"
}
```

### Get Subscription Details
```http
GET /api/subscription/details
Authorization: Bearer <token>
```

### Create Billing Portal Session
```http
POST /api/subscription/create-portal-session
Authorization: Bearer <token>
Content-Type: application/json

{
  "returnUrl": "https://your-app.com/settings"
}
```

### Change Subscription Tier
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

## 6. Subscription Tiers

Your current pricing:

- **Free**: $0/month
  - 1 Star-Inspired Plan (limited)
  - 3-5 meals/week
  - Streak counter

- **Plus**: $9.99/month
  - All Star-Inspired Plans
  - Full weekly planning
  - Grocery list
  - Streak continuation

- **Premium**: $14.99/month
  - Blended plans
  - Personalized portions
  - Weekly insights

## 7. User Flow

1. **User selects a plan** → Frontend calls `create-checkout-session`
2. **User is redirected to Stripe** → Completes payment
3. **Stripe sends webhook** → Your server updates user's subscription tier
4. **User is redirected back** → To your success URL

## 8. Managing Subscriptions

Users can manage their subscriptions (update payment method, cancel, etc.) through the Stripe Customer Portal:

```javascript
// Frontend code example
const response = await fetch('/api/subscription/create-portal-session', {
  method: 'POST',
  headers: {
    'Authorization': `Bearer ${token}`,
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({
    returnUrl: window.location.href
  })
});

const { url } = await response.json();
window.location.href = url; // Redirect to Stripe portal
```

## 9. Going Live

When you're ready to accept real payments:

1. **Complete Stripe account activation**
   - Add business details
   - Verify your identity
   - Add bank account for payouts

2. **Switch to Live Mode**
   - Toggle "View test data" to OFF in Stripe Dashboard
   - Get your **live** API keys (starts with `sk_live_...`)
   - Update your `.env` with live keys

3. **Set up production webhook**
   - Add your production webhook URL
   - Update `STRIPE_WEBHOOK_SECRET` with live webhook secret

4. **Test in production**
   - Use a real card with a small amount
   - Verify webhook events are received
   - Check user subscription is updated correctly

## 10. Security Notes

- ✅ Never expose your secret key in frontend code
- ✅ Always verify webhook signatures
- ✅ Use HTTPS in production
- ✅ Keep your `.env` file out of version control (already in `.gitignore`)
- ✅ Webhook endpoint uses raw body parser for signature verification

## 11. Monitoring

Monitor your subscriptions in the Stripe Dashboard:

- **Payments**: [https://dashboard.stripe.com/payments](https://dashboard.stripe.com/payments)
- **Subscriptions**: [https://dashboard.stripe.com/subscriptions](https://dashboard.stripe.com/subscriptions)
- **Customers**: [https://dashboard.stripe.com/customers](https://dashboard.stripe.com/customers)
- **Webhooks**: [https://dashboard.stripe.com/webhooks](https://dashboard.stripe.com/webhooks)

## 12. Troubleshooting

### Webhook not receiving events
- Check Stripe CLI is running: `stripe listen --forward-to localhost:5080/api/subscription/webhook`
- Verify webhook secret in `.env`
- Check server logs for errors

### Payment succeeded but user tier not updated
- Check webhook events in Stripe Dashboard
- Verify webhook endpoint is receiving events
- Check server logs for webhook processing errors
- Ensure `userId` is in subscription metadata

### "Invalid API Key" error
- Verify `STRIPE_SECRET_KEY` is set in `.env`
- Check you're using the correct key for your environment (test vs live)
- Restart your server after updating `.env`

## 13. Next Steps

- [ ] Set up email notifications for successful/failed payments
- [ ] Add subscription analytics to admin dashboard
- [ ] Implement trial periods (if needed)
- [ ] Set up dunning management for failed payments
- [ ] Add proration preview before tier changes

## Resources

- [Stripe Documentation](https://stripe.com/docs)
- [Stripe API Reference](https://stripe.com/docs/api)
- [Stripe Testing Guide](https://stripe.com/docs/testing)
- [Webhook Best Practices](https://stripe.com/docs/webhooks/best-practices)
