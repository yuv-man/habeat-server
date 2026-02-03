# Frontend Integration Guide

This guide shows how to integrate Stripe subscription payments in your frontend.

## 1. Subscription Flow

### Step 1: Display Pricing Plans

Show your subscription tiers to users:

```typescript
const tiers = [
  {
    id: 'free',
    name: 'Free',
    price: 0,
    features: ['1 Star-Inspired Plan', '3-5 meals/week', 'Streak counter']
  },
  {
    id: 'plus',
    name: 'Plus',
    price: 9.99,
    features: ['All Star-Inspired Plans', 'Full weekly planning', 'Grocery list']
  },
  {
    id: 'premium',
    name: 'Premium',
    price: 14.99,
    features: ['Blended plans', 'Personalized portions', 'Weekly insights']
  }
];
```

### Step 2: Create Checkout Session

When user clicks "Subscribe":

```typescript
async function handleSubscribe(tier: 'plus' | 'premium') {
  try {
    const response = await fetch('http://localhost:5080/api/subscription/create-checkout-session', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${userToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        tier: tier,
        successUrl: `${window.location.origin}/subscription/success`,
        cancelUrl: `${window.location.origin}/subscription/cancel`
      })
    });

    const { url } = await response.json();
    
    // Redirect to Stripe Checkout
    window.location.href = url;
  } catch (error) {
    console.error('Error creating checkout session:', error);
    alert('Failed to start checkout. Please try again.');
  }
}
```

### Step 3: Handle Success/Cancel Pages

Create success and cancel pages:

```typescript
// pages/subscription/success.tsx
export default function SubscriptionSuccess() {
  useEffect(() => {
    // Refresh user data to get updated subscription tier
    fetchUserProfile();
  }, []);

  return (
    <div>
      <h1>Welcome to {tier}!</h1>
      <p>Your subscription is now active.</p>
      <button onClick={() => navigate('/dashboard')}>
        Go to Dashboard
      </button>
    </div>
  );
}

// pages/subscription/cancel.tsx
export default function SubscriptionCancel() {
  return (
    <div>
      <h1>Subscription Cancelled</h1>
      <p>You can try again anytime.</p>
      <button onClick={() => navigate('/pricing')}>
        View Plans
      </button>
    </div>
  );
}
```

## 2. Display Current Subscription

```typescript
async function getSubscriptionDetails() {
  const response = await fetch('http://localhost:5080/api/subscription/details', {
    headers: {
      'Authorization': `Bearer ${userToken}`
    }
  });

  return await response.json();
  // Returns: { tier, status, currentPeriodEnd, cancelAtPeriodEnd }
}

// Usage in component
function SubscriptionStatus() {
  const [subscription, setSubscription] = useState(null);

  useEffect(() => {
    getSubscriptionDetails().then(setSubscription);
  }, []);

  if (!subscription) return <div>Loading...</div>;

  return (
    <div>
      <h2>Current Plan: {subscription.tier}</h2>
      <p>Status: {subscription.status}</p>
      {subscription.currentPeriodEnd && (
        <p>Renews on: {new Date(subscription.currentPeriodEnd).toLocaleDateString()}</p>
      )}
    </div>
  );
}
```

## 3. Manage Subscription (Billing Portal)

Allow users to update payment method, cancel, etc.:

```typescript
async function openBillingPortal() {
  try {
    const response = await fetch('http://localhost:5080/api/subscription/create-portal-session', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${userToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        returnUrl: window.location.href
      })
    });

    const { url } = await response.json();
    
    // Redirect to Stripe Customer Portal
    window.location.href = url;
  } catch (error) {
    console.error('Error opening billing portal:', error);
  }
}

// Usage
<button onClick={openBillingPortal}>
  Manage Subscription
</button>
```

## 4. Upgrade/Downgrade Subscription

```typescript
async function changeTier(newTier: 'plus' | 'premium' | 'free') {
  try {
    const response = await fetch('http://localhost:5080/api/subscription/change-tier', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${userToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        tier: newTier
      })
    });

    const result = await response.json();
    
    if (response.ok) {
      alert('Subscription updated successfully!');
      // Refresh user data
      fetchUserProfile();
    } else {
      alert('Failed to update subscription');
    }
  } catch (error) {
    console.error('Error changing tier:', error);
  }
}
```

## 5. Cancel Subscription

```typescript
async function cancelSubscription() {
  if (!confirm('Are you sure you want to cancel your subscription?')) {
    return;
  }

  try {
    const response = await fetch('http://localhost:5080/api/subscription/cancel', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${userToken}`
      }
    });

    if (response.ok) {
      alert('Subscription cancelled. You can continue using premium features until the end of your billing period.');
      // Refresh subscription details
      getSubscriptionDetails();
    }
  } catch (error) {
    console.error('Error cancelling subscription:', error);
  }
}
```

## 6. Feature Gating

Restrict features based on subscription tier:

```typescript
// utils/subscription.ts
export function hasFeatureAccess(
  userTier: 'free' | 'plus' | 'premium',
  feature: string
): boolean {
  const tierRank = { free: 0, plus: 1, premium: 2 };
  
  const featureRequirements = {
    'star-plans-all': 'plus',
    'grocery-list': 'plus',
    'streak-continuation': 'plus',
    'blended-plans': 'premium',
    'personalized-portions': 'premium',
    'weekly-insights': 'premium'
  };

  const requiredTier = featureRequirements[feature] || 'free';
  return tierRank[userTier] >= tierRank[requiredTier];
}

// Usage in component
function FeatureButton({ feature, children }) {
  const { user } = useAuth();
  const hasAccess = hasFeatureAccess(user.subscriptionTier, feature);

  if (!hasAccess) {
    return (
      <button onClick={() => navigate('/pricing')}>
        🔒 Upgrade to unlock
      </button>
    );
  }

  return <button>{children}</button>;
}
```

## 7. Complete Example Component

```typescript
import { useState, useEffect } from 'react';

function SubscriptionPage() {
  const [subscription, setSubscription] = useState(null);
  const [loading, setLoading] = useState(true);
  const { user, token } = useAuth();

  useEffect(() => {
    loadSubscription();
  }, []);

  async function loadSubscription() {
    try {
      const response = await fetch('http://localhost:5080/api/subscription/details', {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      const data = await response.json();
      setSubscription(data);
    } catch (error) {
      console.error('Error loading subscription:', error);
    } finally {
      setLoading(false);
    }
  }

  async function handleUpgrade(tier: 'plus' | 'premium') {
    const response = await fetch('http://localhost:5080/api/subscription/create-checkout-session', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        tier,
        successUrl: `${window.location.origin}/subscription/success`,
        cancelUrl: `${window.location.origin}/subscription/cancel`
      })
    });

    const { url } = await response.json();
    window.location.href = url;
  }

  async function handleManage() {
    const response = await fetch('http://localhost:5080/api/subscription/create-portal-session', {
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
    window.location.href = url;
  }

  if (loading) return <div>Loading...</div>;

  return (
    <div>
      <h1>Subscription</h1>
      
      <div className="current-plan">
        <h2>Current Plan: {subscription.tier}</h2>
        <p>Status: {subscription.status}</p>
        
        {subscription.status === 'active' && (
          <button onClick={handleManage}>
            Manage Subscription
          </button>
        )}
      </div>

      <div className="plans">
        <div className="plan">
          <h3>Plus - $9.99/month</h3>
          <ul>
            <li>All Star-Inspired Plans</li>
            <li>Full weekly planning</li>
            <li>Grocery list</li>
          </ul>
          {subscription.tier === 'free' && (
            <button onClick={() => handleUpgrade('plus')}>
              Upgrade to Plus
            </button>
          )}
        </div>

        <div className="plan">
          <h3>Premium - $14.99/month</h3>
          <ul>
            <li>Everything in Plus</li>
            <li>Blended plans</li>
            <li>Personalized portions</li>
            <li>Weekly insights</li>
          </ul>
          {subscription.tier !== 'premium' && (
            <button onClick={() => handleUpgrade('premium')}>
              Upgrade to Premium
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

export default SubscriptionPage;
```

## 8. Environment Variables

Add to your frontend `.env`:

```env
VITE_API_URL=http://localhost:5080
# or for production:
# VITE_API_URL=https://api.your-domain.com
```

## 9. TypeScript Types

```typescript
// types/subscription.ts
export type SubscriptionTier = 'free' | 'plus' | 'premium';

export type SubscriptionStatus = 
  | 'active' 
  | 'canceled' 
  | 'past_due' 
  | 'trialing' 
  | 'incomplete' 
  | 'incomplete_expired' 
  | 'unpaid' 
  | 'none';

export interface SubscriptionDetails {
  tier: SubscriptionTier;
  status: SubscriptionStatus;
  currentPeriodEnd?: Date;
  cancelAtPeriodEnd?: boolean;
}

export interface CreateCheckoutSessionRequest {
  tier: SubscriptionTier;
  successUrl: string;
  cancelUrl: string;
}

export interface CreateCheckoutSessionResponse {
  url: string;
}
```

## 10. Error Handling

```typescript
async function handleSubscriptionAction(action: () => Promise<any>) {
  try {
    setLoading(true);
    await action();
  } catch (error) {
    if (error.response?.status === 401) {
      // User not authenticated
      navigate('/login');
    } else if (error.response?.status === 400) {
      // Bad request (e.g., trying to subscribe to free tier)
      alert('Invalid subscription action');
    } else {
      // Generic error
      alert('Something went wrong. Please try again.');
    }
    console.error('Subscription error:', error);
  } finally {
    setLoading(false);
  }
}
```

## 11. Testing

Use Stripe test cards in development:

- **Success**: 4242 4242 4242 4242
- **Decline**: 4000 0000 0000 0002
- Any future expiry, any CVC, any ZIP

## 12. Mobile Apps (React Native / Ionic)

For mobile apps, you can use the same flow but open Stripe Checkout in an in-app browser:

```typescript
import { Browser } from '@capacitor/browser';

async function handleSubscribe(tier: 'plus' | 'premium') {
  const response = await fetch('http://localhost:5080/api/subscription/create-checkout-session', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      tier,
      successUrl: 'myapp://subscription/success',
      cancelUrl: 'myapp://subscription/cancel'
    })
  });

  const { url } = await response.json();
  
  // Open in in-app browser
  await Browser.open({ url });
}
```

Remember to handle deep links for success/cancel URLs in your mobile app!
