import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import { storage } from "./storage";
import type { Express, Request, Response } from "express";
import passport from "passport";
import { Strategy as GoogleStrategy } from "passport-google-oauth20";

const JWT_SECRET = process.env.JWT_SECRET || process.env.SESSION_SECRET || "your-secret-key-change-in-production";

/** OAuth callback must be a public HTTPS URL in production; localhost breaks mobile after Google redirects. */
function getGoogleOAuthCallbackUrl(): string {
  const explicit = process.env.GOOGLE_CALLBACK_URL?.trim();
  if (explicit) return explicit;
  const render = process.env.RENDER_EXTERNAL_URL?.trim();
  if (render) {
    return `${render.replace(/\/$/, "")}/api/auth/google/callback`;
  }
  const port = process.env.PORT || "3002";
  return `http://localhost:${port}/api/auth/google/callback`;
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
  const GOOGLE_CALLBACK_URL = getGoogleOAuthCallbackUrl();

  if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET) {
    console.warn("⚠️  Google OAuth not configured. Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET to enable Google sign-in.");
    return false;
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
        callbackURL: GOOGLE_CALLBACK_URL,
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
      // Log the callback URL being used for debugging
      const callbackURL = getGoogleOAuthCallbackUrl();
      console.log("🔐 Initiating Google OAuth with callback URL:", callbackURL);
      passport.authenticate("google", { 
        scope: ["profile", "email"]
      })(req, res, next);
    }
  );

  app.get(
    "/api/auth/google/callback",
    passport.authenticate("google", { 
      failureRedirect: "/login?error=auth_failed",
      session: false
    }),
    async (req: any, res: Response) => {
      try {
        console.log("🔐 Google OAuth callback - req.user:", JSON.stringify(req.user, null, 2));
        
        if (!req.user) {
          console.error("❌ No user in Google OAuth callback");
          return res.redirect("/login?error=auth_failed");
        }

        const user = req.user as AuthUser;
        console.log("✅ Generating token for user:", user.id, user.email);
        
        const token = generateToken(user);
        console.log("✅ Token generated, redirecting with token");
        
        // Don't use session login - we're using JWT tokens
        // The token will be stored in localStorage on the client
        
        // Redirect to login page with token (client will store it and redirect)
        res.redirect(`/login?token=${token}`);
      } catch (error) {
        console.error("❌ Google OAuth callback error:", error);
        res.redirect("/login?error=auth_failed");
      }
    }
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

