import Link from "next/link";
import { login } from "../actions";
import { ErrorBox } from "../components";

export default async function Login({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { error } = await searchParams;
  return (
    <div className="card" style={{ maxWidth: 420, margin: "40px auto" }}>
      <h1>Log in</h1>
      <p className="sub">Semantic Document Version Change Tracking</p>
      <ErrorBox error={error} />
      <form action={login}>
        <label>Email</label><input name="email" type="email" required autoComplete="username" />
        <label>Password</label><input name="password" type="password" required autoComplete="current-password" />
        <p><button>Log in</button> <Link href="/register" className="btn alt">Create account</Link></p>
      </form>
    </div>
  );
}
