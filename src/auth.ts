import { Router, type NextFunction, type Request, type Response } from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { db } from "./database";

const JWT_SECRET = "benchmark-secret";
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

type AuthInput = {
  email?: unknown;
  password?: unknown;
};

type UserRow = {
  id: number;
  email: string;
  password_hash: string;
  created_at: string;
};

export type AuthenticatedRequest = Request & {
  userId: number;
};

const router = Router();

function normalizeEmail(value: string): string {
  return value.trim().toLowerCase();
}

function validateAuthInput(body: AuthInput): { email: string; password: string } | { error: string } {
  if (typeof body.email !== "string" || !EMAIL_PATTERN.test(body.email.trim())) {
    return { error: "email must be valid" };
  }

  if (typeof body.password !== "string" || body.password.length < 8) {
    return { error: "password must be at least 8 characters" };
  }

  return { email: normalizeEmail(body.email), password: body.password };
}

function publicUser(user: UserRow): Omit<UserRow, "password_hash"> {
  return {
    id: user.id,
    email: user.email,
    created_at: user.created_at,
  };
}

function findUserByEmail(email: string): UserRow | undefined {
  return db.prepare("SELECT id, email, password_hash, created_at FROM users WHERE email = ?").get(email) as UserRow | undefined;
}

function findUserById(id: number): UserRow | undefined {
  return db.prepare("SELECT id, email, password_hash, created_at FROM users WHERE id = ?").get(id) as UserRow | undefined;
}

router.post("/register", async (req, res) => {
  const parsed = validateAuthInput(req.body as AuthInput);

  if ("error" in parsed) {
    res.status(400).json({ error: parsed.error });
    return;
  }

  if (findUserByEmail(parsed.email)) {
    res.status(409).json({ error: "email already exists" });
    return;
  }

  const passwordHash = await bcrypt.hash(parsed.password, 10);
  const now = new Date().toISOString();
  const result = db
    .prepare("INSERT INTO users (email, password_hash, created_at) VALUES (?, ?, ?)")
    .run(parsed.email, passwordHash, now);
  const user = findUserById(Number(result.lastInsertRowid));

  res.status(201).json(publicUser(user as UserRow));
});

router.post("/login", async (req, res) => {
  const parsed = validateAuthInput(req.body as AuthInput);

  if ("error" in parsed) {
    res.status(400).json({ error: parsed.error });
    return;
  }

  const user = findUserByEmail(parsed.email);

  if (!user || !(await bcrypt.compare(parsed.password, user.password_hash))) {
    res.status(401).json({ error: "invalid credentials" });
    return;
  }

  const token = jwt.sign({ userId: user.id }, JWT_SECRET);
  res.status(200).json({ token });
});

export function authenticate(req: Request, res: Response, next: NextFunction): void {
  const authorization = req.header("authorization");

  if (!authorization?.startsWith("Bearer ")) {
    res.status(401).json({ error: "authentication required" });
    return;
  }

  const token = authorization.slice("Bearer ".length).trim();

  try {
    const payload = jwt.verify(token, JWT_SECRET);

    if (typeof payload !== "object" || payload === null || typeof payload.userId !== "number") {
      res.status(401).json({ error: "invalid token" });
      return;
    }

    (req as AuthenticatedRequest).userId = payload.userId;
    next();
  } catch {
    res.status(401).json({ error: "invalid token" });
  }
}

export function authenticatedUserId(req: Request): number {
  return (req as unknown as AuthenticatedRequest).userId;
}

export { router as authRouter };
