import { NextRequest, NextResponse } from "next/server";
import { jwtVerify } from "jose";

// First gate only: the signed cookie must be valid. Each page and action then
// loads the user from the database and checks role / document access itself.
export async function middleware(req: NextRequest) {
  const token = req.cookies.get("session")?.value;
  try {
    if (!token) throw new Error("no session");
    await jwtVerify(token, new TextEncoder().encode(process.env.AUTH_SECRET));
    return NextResponse.next();
  } catch {
    return NextResponse.redirect(new URL("/login", req.url));
  }
}

export const config = { matcher: ["/((?!login|register|_next|favicon.ico).*)"] };
