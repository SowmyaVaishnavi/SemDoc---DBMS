import { SignJWT, jwtVerify } from "jose";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { q } from "./db";

export type Role = "Admin" | "Editor" | "Viewer";
export type User = { user_id: number; name: string; email: string; role: Role };

const secret = () => {
  const s = process.env.AUTH_SECRET;
  if (!s || s.length < 16) throw new Error("AUTH_SECRET is missing or too short (see .env.example)");
  return new TextEncoder().encode(s);
};

export async function createSession(userId: number) {
  const token = await new SignJWT({ uid: userId })
    .setProtectedHeader({ alg: "HS256" })
    .setExpirationTime("8h")
    .sign(secret());
  (await cookies()).set("session", token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 8 * 3600,
  });
}

export async function destroySession() {
  (await cookies()).delete("session");
}

/** Reads the cookie, then loads the user fresh so role changes apply immediately. */
export async function getUser(): Promise<User | null> {
  const token = (await cookies()).get("session")?.value;
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, secret());
    const rows = await q<User>("SELECT user_id, name, email, role FROM users WHERE user_id = $1", [payload.uid]);
    return rows[0] ?? null;
  } catch {
    return null;
  }
}

export async function requireUser(): Promise<User> {
  const u = await getUser();
  if (!u) redirect("/login");
  return u;
}

export async function requireAdmin(): Promise<User> {
  const u = await requireUser();
  if (u.role !== "Admin") redirect("/?error=Admin+only");
  return u;
}
