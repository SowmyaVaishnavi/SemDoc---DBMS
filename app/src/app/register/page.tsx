import Link from "next/link";
import { register } from "../actions";
import { ErrorBox } from "../components";

export default async function Register({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { error } = await searchParams;
  return (
    <div className="card" style={{ maxWidth: 420, margin: "40px auto" }}>
      <h1>Create account</h1>
      <p className="sub">After signing up you can create your own documents, work on their versions and share them with teammates as Viewer or Editor.</p>
      <ErrorBox error={error} />
      <form action={register}>
        <label>Name</label><input name="name" required maxLength={100} />
        <label>Email</label><input name="email" type="email" required />
        <label>Password (min 8 characters)</label><input name="password" type="password" required minLength={8} autoComplete="new-password" />
        <p><button>Sign up</button> <Link href="/login" className="btn alt">Back to log in</Link></p>
      </form>
    </div>
  );
}
