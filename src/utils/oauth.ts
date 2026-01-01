import logger from "./logger";
import jwt from "jsonwebtoken";
import { OAuth2Client } from "google-auth-library";

// Get Google OAuth authorization URL
export const getGoogleAuthUrl = (
  redirectUri: string,
  state?: string,
  prompt?: string
): string | null => {
  try {
    const googleClientId = process.env.GOOGLE_CLIENT_ID;
    const googleClientSecret = process.env.GOOGLE_CLIENT_SECRET;

    if (!googleClientId || !googleClientSecret) {
      logger.error(
        "GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET must be set for OAuth flow"
      );
      return null;
    }

    const client = new OAuth2Client(
      googleClientId,
      googleClientSecret,
      redirectUri
    );

    const scopes = [
      "https://www.googleapis.com/auth/userinfo.email",
      "https://www.googleapis.com/auth/userinfo.profile",
    ];

    const authUrl = client.generateAuthUrl({
      access_type: "offline",
      scope: scopes,
      prompt: prompt || "consent", // Use provided prompt or default to "consent"
      state: state, // Pass state through OAuth flow
    });

    return authUrl;
  } catch (error: any) {
    logger.error("Error generating Google auth URL:", error.message);
    return null;
  }
};

// Exchange authorization code for tokens
export const exchangeGoogleCodeForTokens = async (
  code: string,
  redirectUri: string
): Promise<{ idToken: string; accessToken: string } | null> => {
  try {
    const googleClientId = process.env.GOOGLE_CLIENT_ID;
    const googleClientSecret = process.env.GOOGLE_CLIENT_SECRET;

    if (!googleClientId || !googleClientSecret) {
      logger.error(
        "GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET must be set to exchange authorization code"
      );
      return null;
    }

    const client = new OAuth2Client(
      googleClientId,
      googleClientSecret,
      redirectUri
    );

    const { tokens } = await client.getToken(code);

    if (!tokens.id_token) {
      logger.error("No ID token received from Google", {
        redirectUri,
        hasAccessToken: !!tokens.access_token,
        tokenKeys: Object.keys(tokens || {}),
      });
      return null;
    }

    return {
      idToken: tokens.id_token,
      accessToken: tokens.access_token || "",
    };
  } catch (error: any) {
    logger.error("Error exchanging Google code for tokens:", {
      message: error?.message,
      code: error?.code,
      redirectUri,
      errorDetails: error,
    });
    return null;
  }
};

// Google OAuth verification
export const verifyGoogleToken = async (idToken: string): Promise<any> => {
  try {
    const googleClientId = process.env.GOOGLE_CLIENT_ID;

    // If GOOGLE_CLIENT_ID is set, use proper verification
    if (googleClientId) {
      const client = new OAuth2Client(googleClientId);

      try {
        const ticket = await client.verifyIdToken({
          idToken: idToken,
          audience: googleClientId,
        });

        const payload = ticket.getPayload();

        if (!payload) {
          logger.error("Google token verification failed: No payload");
          return null;
        }

        // Extract user information from the verified token payload
        return {
          sub: payload.sub,
          email: payload.email,
          given_name: payload.given_name,
          family_name: payload.family_name,
          name: payload.name,
          picture: payload.picture,
          email_verified: payload.email_verified,
        };
      } catch (verifyError: any) {
        logger.error("Google token verification error:", verifyError.message);
        return null;
      }
    }

    // Fallback for development: decode the JWT token without verification
    // WARNING: This should only be used in development/testing
    logger.warn(
      "GOOGLE_CLIENT_ID not set. Using unverified token decoding (development mode only)"
    );
    const decoded = jwt.decode(idToken, { complete: true });

    if (!decoded || typeof decoded === "string") {
      logger.error("Invalid Google token format");
      return null;
    }

    const payload = decoded.payload as any;

    // Extract user information from the token payload
    return {
      sub: payload.sub,
      email: payload.email,
      given_name: payload.given_name,
      family_name: payload.family_name,
      name: payload.name,
      picture: payload.picture,
      email_verified: payload.email_verified,
    };
  } catch (error) {
    logger.error("Error verifying Google token:", error);
    return null;
  }
};

// Facebook OAuth verification
export const verifyFacebookToken = async (
  accessToken: string
): Promise<any> => {
  try {
    // Verify with Facebook Graph API
    const response = await fetch(
      `https://graph.facebook.com/me?access_token=${accessToken}&fields=id,email,first_name,last_name,picture.type(large)`
    );

    if (!response.ok) {
      logger.error(
        `Facebook token verification failed: ${response.status} ${response.statusText}`
      );
      return null;
    }

    const userData = await response.json();

    // Check if Facebook returned an error
    if (userData.error) {
      logger.error("Facebook API error:", userData.error);
      return null;
    }

    // Get picture URL if available
    let pictureUrl = null;
    if (userData.picture?.data?.url) {
      pictureUrl = userData.picture.data.url;
    }

    return {
      id: userData.id,
      email: userData.email,
      first_name: userData.first_name,
      last_name: userData.last_name,
      picture: pictureUrl,
    };
  } catch (error) {
    logger.error("Error verifying Facebook token:", error);
    return null;
  }
};

// Generate OAuth password for users
export const generateOAuthPassword = (
  provider: "google" | "facebook"
): string => {
  return `${provider}_oauth_${Math.random().toString(36).substr(2, 15)}`;
};

// Check if user is OAuth user
export const isOAuthUser = (password: string): boolean => {
  return (
    password.startsWith("google_oauth_") ||
    password.startsWith("facebook_oauth_")
  );
};
