import { NextFunction, Request, Response } from "express";
import { UserRole } from "../models/User";
import { JwtPayload, verifyToken } from "../utils/jwt";
import { AppError } from "./errorHandler";

// Augment Express's Request type so req.user is typed everywhere
// downstream without repeated casts.
declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: JwtPayload;
    }
  }
}

/**
 * Verifies the Bearer token on the Authorization header and attaches
 * the decoded payload to req.user. Does not hit the database — callers
 * that need the live user record (e.g. to check isActive) should load
 * it explicitly.
 */
export function authenticate(req: Request, _res: Response, next: NextFunction) {
  const header = req.headers.authorization;

  if (!header || !header.startsWith("Bearer ")) {
    return next(new AppError("Authentication required", 401, "UNAUTHENTICATED"));
  }

  const token = header.slice("Bearer ".length).trim();

  try {
    req.user = verifyToken(token);
    return next();
  } catch {
    return next(new AppError("Invalid or expired token", 401, "INVALID_TOKEN"));
  }
}

/**
 * Restricts a route to one or more roles. Must run after `authenticate`.
 * Usage: router.get("/admin-only", authenticate, authorize("admin"), handler)
 */
export function authorize(...allowedRoles: UserRole[]) {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (!req.user) {
      return next(new AppError("Authentication required", 401, "UNAUTHENTICATED"));
    }
    if (!allowedRoles.includes(req.user.role)) {
      return next(new AppError("You do not have permission to perform this action", 403, "FORBIDDEN"));
    }
    return next();
  };
}
