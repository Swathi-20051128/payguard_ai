import { Router } from "express";
import rateLimit from "express-rate-limit";
import { authenticate } from "../middleware/auth";
import { loginUser, registerUser, getUserById } from "../services/authService";
import { asyncHandler } from "../utils/asyncHandler";
import { loginSchema, registerSchema } from "../validation/authSchemas";

export const authRouter = Router();

/**
 * Auth endpoints get a tighter rate limit than the rest of the API to
 * slow down credential-stuffing / brute-force attempts.
 */
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: { code: "TOO_MANY_REQUESTS", message: "Too many auth attempts. Please try again later." } },
});

authRouter.post(
  "/auth/register",
  authLimiter,
  asyncHandler(async (req, res) => {
    const input = registerSchema.parse(req.body);
    const result = await registerUser(input);
    res.status(201).json(result);
  })
);

authRouter.post(
  "/auth/login",
  authLimiter,
  asyncHandler(async (req, res) => {
    const input = loginSchema.parse(req.body);
    const result = await loginUser(input);
    res.status(200).json(result);
  })
);

authRouter.get(
  "/auth/me",
  authenticate,
  asyncHandler(async (req, res) => {
    const user = await getUserById(req.user!.sub);
    res.status(200).json({ user });
  })
);

/**
 * JWTs are stateless, so there is nothing to invalidate server-side
 * in this MVP (no refresh-token/session store yet). This endpoint
 * exists so the frontend has a single, semantic call to make when the
 * user logs out; it always succeeds, and the frontend clears its
 * locally stored token.
 */
authRouter.post(
  "/auth/logout",
  authenticate,
  asyncHandler(async (_req, res) => {
    res.status(200).json({ message: "Logged out" });
  })
);
