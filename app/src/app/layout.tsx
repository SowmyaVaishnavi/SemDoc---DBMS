import "./globals.css";
import type { ReactNode } from "react";
import Link from "next/link";
import { getUser } from "@/lib/auth";
import { logout } from "./actions";

export const metadata = { title: "SemDoc — semantic version tracking" };

export default async function RootLayout({ children }: { children: ReactNode }) {
  const user = await getUser();
  return (
    <html lang="en">
      <body>
        <nav>
          <Link href="/" className="brand">SemDoc</Link>
          {user && (<>
            <Link href="/">Dashboard</Link>
            <Link href="/documents">Documents</Link>
            <Link href="/search">Semantic search</Link>
            {user.role === "Admin" && <Link href="/admin/users">Users</Link>}
            <span className="sp" />
            <small>{user.name} · {user.role}</small>
            <form action={logout}><button className="alt">Log out</button></form>
          </>)}
        </nav>
        <main>{children}</main>
      </body>
    </html>
  );
}
