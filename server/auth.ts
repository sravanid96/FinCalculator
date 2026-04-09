import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import { storage } from "./storage";
import type { Express, Request, Response, NextFunction } from "express";
import passport from "passport";
import { Strategy as GoogleStrategy } from "passport-google-oauth20";

const JWT_SECRET = process.env.JWT_SECRET || process.env.SESSION_SECRET || "your-secret-key-change-in-production";

/**
 * Google OAuth redirect_uri must match byte-for-byte on authorize + token exchange.
 * A relative path lets passport-oauth2 build the full URL from each request's Host +
 * X-Forwarded-Proto (needs trust proxy on Render). That avoids 400 "Bad Request" when
 * RENDER_EXTERNAL_URL / env URL ≠ the URL users actually open (www, custom domain, typo).
 *
 * Set GOOGLE_CALLBACK_URL only if you need a fixed absolute URL.
 */
const GOOGLE_OAUTH_CALLBACK_PATH = "/api/auth/google/callback";

function googleStrategyCallbackUrl(): string {
  const explicit = process.env.GOOGLE_CALLBACK_URL?.trim();
  if (explicit) return explicit;
  return GOOGLE_OAUTH_CALLBACK_PATH;
}

export interface AuthUser {
  id: string;
  email: string;
  firstName?: string;
  lastName?: string;
}

// JWT token generation
function generateToken(user: AuthUser): string {
  return jwt.sign(
    { id: user.id, email: user.email },
    JWT_SECRET,
    { expiresIn: "7d" }
  );
}

// Register new user with email/password
export async function register(req: Request, res: Response) {
  try {
    const { email, password, firstName, lastName } = req.body;

    if (!email || !password) {
      return res.status(400).json({ message: "Email and password are required" });
    }

    if (password.length < 6) {
      return res.status(400).json({ message: "Password must be at least 6 characters" });
    }

    // Check if user already exists
    const existingUser = await storage.getUserByEmail(email);
    if (existingUser) {
      return res.status(400).json({ message: "User with this email already exists" });
    }

    // Hash password
    const hashedPassword = await bcrypt.hash(password, 10);

    // Create user
    const user = await storage.upsertUser({
      email,
      password: hashedPassword,
      firstName: firstName || null,
      lastName: lastName || null,
      authProvider: "email",
    } as any);

    // Generate token
    const token = generateToken({
      id: user.id,
      email: user.email ?? "",
      firstName: user.firstName || undefined,
      lastName: user.lastName || undefined,
    });

    // Set session
    (req as any).login({ id: user.id, email: user.email }, (err: any) => {
      if (err) {
        console.error("Login error:", err);
      }
    });

    res.json({
      user: {
        id: user.id,
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
        profileImageUrl: user.profileImageUrl,
      },
      token,
    });
  } catch (error) {
    console.error("Registration error:", error);
    res.status(500).json({ message: "Failed to register user" });
  }
}

// Login with email/password
export async function login(req: Request, res: Response) {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ message: "Email and password are required" });
    }

    // Find user
    const user = await storage.getUserByEmail(email);
    if (!user) {
      return res.status(401).json({ message: "Invalid email or password" });
    }

    // Check password
    if (!user.password) {
      return res.status(401).json({ message: "This account uses a different sign-in method" });
    }

    const isValidPassword = await bcrypt.compare(password, user.password);
    if (!isValidPassword) {
      return res.status(401).json({ message: "Invalid email or password" });
    }

    // Generate token
    const token = generateToken({
      id: user.id,
      email: user.email ?? "",
      firstName: user.firstName || undefined,
      lastName: user.lastName || undefined,
    });

    // Set session
    (req as any).login({ id: user.id, email: user.email }, (err: any) => {
      if (err) {
        console.error("Login error:", err);
      }
    });

    res.json({
      user: {
        id: user.id,
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
        profileImageUrl: user.profileImageUrl,
      },
      token,
    });
  } catch (error) {
    console.error("Login error:", error);
    res.status(500).json({ message: "Failed to login" });
  }
}

// Setup Google OAuth
export function setupGoogleAuth(app: Express): boolean {
  const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
  const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;
  const strategyCallbackUrl = googleStrategyCallbackUrl();

  if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET) {
    console.warn("⚠️  Google OAuth not configured. Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET to enable Google sign-in.");
    return false;
  }

  const explicitCallback = process.env.GOOGLE_CALLBACK_URL?.trim();
  const isLocalExplicit =
    explicitCallback &&
    (explicitCallback.includes("localhost") || explicitCallback.includes("127.0.0.1"));
  if (process.env.NODE_ENV === "production" && isLocalExplicit) {
    console.error(
      "GOOGLE_CALLBACK_URL points at localhost in production — phones will fail. " +
        "Remove it to use per-request host, or set it to https://YOUR-SERVICE.onrender.com/api/auth/google/callback.",
    );
  }
  if (!explicitCallback && process.env.NODE_ENV === "production") {
    console.log(
      "Google OAuth: using relative callback path; redirect_uri = https://<request-host>/api/auth/google/callback (trust proxy). " +
        "Register that full URL in Google Cloud Console for each domain you use.",
    );
  }

  // Ensure passport serialization is set up for Google auth
  passport.serializeUser((user: any, cb) => {
    cb(null, user);
  });
  passport.deserializeUser((user: any, cb) => {
    cb(null, user);
  });

  passport.use(
    new GoogleStrategy(
      {
        clientID: GOOGLE_CLIENT_ID,
        clientSecret: GOOGLE_CLIENT_SECRET,
        callbackURL: strategyCallbackUrl,
        proxy: true,
      },
      async (accessToken, refreshToken, profile, done) => {
        try {
          const email = profile.emails?.[0]?.value;
          if (!email) {
            return done(new Error("No email found in Google profile"), undefined);
          }

          // Find or create user
          let user = await storage.getUserByEmail(email);
          if (!user) {
            user = await storage.upsertUser({
              email,
              firstName: profile.name?.givenName || null,
              lastName: profile.name?.familyName || null,
              profileImageUrl: profile.photos?.[0]?.value || null,
              authProvider: "google",
              password: null,
            } as any);
          } else if (user.authProvider !== "google") {
            // Update existing user to use Google auth
            user = await storage.upsertUser({
              ...user,
              authProvider: "google",
              profileImageUrl: profile.photos?.[0]?.value || user.profileImageUrl,
            });
          }

          return done(null, {
            id: user.id,
            email: user.email,
            firstName: user.firstName || undefined,
            lastName: user.lastName || undefined,
          } as AuthUser);
        } catch (error) {
          return done(error, undefined);
        }
      }
    )
  );
  return true;
}

// Google OAuth routes
export function setupGoogleRoutes(app: Express) {
  const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
  const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;

  // Only set up routes if Google auth is configured
  if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET) {
    // Return error if someone tries to use Google auth without configuration
    app.get("/api/auth/google", (req, res) => {
      res.status(400).json({ 
        message: "Google OAuth is not configured. Please set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET environment variables." 
      });
    });
    app.get("/api/auth/google/callback", (req, res) => {
      res.redirect("/login?error=google_not_configured");
    });
    return;
  }

  app.get(
    "/api/auth/google",
    (req, res, next) => {
      const opt = googleStrategyCallbackUrl();
      console.log(
        "🔐 Initiating Google OAuth; callbackURL option:",
        opt.startsWith("/") ? `${opt} (absolute redirect_uri built from request URL)` : opt,
      );
      passport.authenticate("google", { 
        scope: ["profile", "email"]
      })(req, res, next);
    }
  );

  app.get(
    "/api/auth/google/callback",
    (req: Request, res: Response, next: NextFunction) => {
      // Passport sends token exchange / strategy failures via next(err) — without this, Express returns 500 JSON.
      passport.authenticate(
        "google",
        { session: false },
        (err: unknown, user: false | AuthUser | null | undefined, info: unknown) => {
          if (err) {
            const msg =
              err instanceof Error
                ? err.message
                : typeof err === "string"
                  ? err
                  : "oauth_error";
            console.error("Google OAuth callback passport error:", err);
            return res.redirect(
              `/login?error=auth_failed&detail=${encodeURIComponent(msg.slice(0, 240))}`,
            );
          }
          if (!user) {
            console.warn("Google OAuth callback: no user", info);
            return res.redirect("/login?error=auth_failed");
          }
          (req as Request & { user: AuthUser }).user = user;
          next();
        },
      )(req, res, next);
    },
    async (req: Request, res: Response) => {
      try {
        const user = (req as Request & { user?: AuthUser }).user;
        console.log("🔐 Google OAuth callback - req.user:", JSON.stringify(user, null, 2));

        if (!user?.id || !user.email) {
          console.error("❌ No user in Google OAuth callback");
          return res.redirect("/login?error=auth_failed");
        }

        console.log("✅ Generating token for user:", user.id, user.email);

        const token = generateToken(user);
        console.log("✅ Token generated, redirecting with token");

        res.redirect(`/login?token=${encodeURIComponent(token)}`);
      } catch (error) {
        console.error("❌ Google OAuth callback error:", error);
        res.redirect("/login?error=auth_failed");
      }
    },
  );
}

// Middleware to verify JWT token
export function verifyToken(req: Request, res: Response, next: any) {
  const authHeader = req.headers.authorization;
  const token = authHeader?.startsWith("Bearer ") ? authHeader.substring(7) : null;

  if (token) {
    try {
      const decoded = jwt.verify(token, JWT_SECRET) as AuthUser;
      (req as any).user = decoded;
      return next();
    } catch (error) {
      // Token invalid, continue to session check
    }
  }

  // Fall back to session-based auth
  if ((req as any).isAuthenticated && (req as any).isAuthenticated()) {
    return next();
  }

  return res.status(401).json({ message: "Unauthorized" });
}

