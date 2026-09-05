import { IUser, User } from "../models/User";
import { comparePassword, hashPassword } from "../utils/password";
import { JwtPayload, signToken } from "../utils/jwt";
import { AppError } from "../middleware/errorHandler";
import { LoginInput, RegisterInput } from "../validation/authSchemas";

export interface AuthResult {
  token: string;
  user: Pick<IUser, "id" | "name" | "email" | "role" | "isActive">;
}

/**
 * Public self-registration always creates a "viewer" — the lowest
 * privilege role. Only an authenticated admin can promote a user to
 * "analyst" or "admin" (see admin user-management routes). This
 * prevents privilege escalation via the open registration endpoint.
 */
export async function registerUser(input: RegisterInput): Promise<AuthResult> {
  const existing = await User.findOne({ email: input.email });
  if (existing) {
    throw new AppError("An account with this email already exists", 409, "EMAIL_IN_USE");
  }

  const passwordHash = await hashPassword(input.password);

  const user = await User.create({
    name: input.name,
    email: input.email,
    passwordHash,
    role: "viewer",
  });

  return buildAuthResult(user);
}

export async function loginUser(input: LoginInput): Promise<AuthResult> {
  // passwordHash has `select: false` on the schema, so it must be
  // explicitly requested here.
  const user = await User.findOne({ email: input.email }).select("+passwordHash");

  // Deliberately generic error message — do not reveal whether the
  // email exists, to avoid account enumeration.
  const invalidCredentialsError = new AppError("Invalid email or password", 401, "INVALID_CREDENTIALS");

  if (!user) throw invalidCredentialsError;
  if (!user.isActive) throw new AppError("This account has been deactivated", 403, "ACCOUNT_DISABLED");

  const valid = await comparePassword(input.password, user.passwordHash);
  if (!valid) throw invalidCredentialsError;

  return buildAuthResult(user);
}

export async function getUserById(id: string): Promise<IUser> {
  const user = await User.findById(id);
  if (!user) throw new AppError("User not found", 404, "USER_NOT_FOUND");
  return user;
}

function buildAuthResult(user: IUser): AuthResult {
  const payload: JwtPayload = { sub: user.id, role: user.role, email: user.email };
  const token = signToken(payload);
  return {
    token,
    user: { id: user.id, name: user.name, email: user.email, role: user.role, isActive: user.isActive },
  };
}
