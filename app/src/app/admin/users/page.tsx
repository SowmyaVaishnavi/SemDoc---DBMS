import { requireAdmin } from "@/lib/auth";
import { fmt, q } from "@/lib/db";
import { setUserRoleAction } from "../../actions";
import { ErrorBox } from "../../components";

export default async function Users({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const admin = await requireAdmin();
  const { error } = await searchParams;
  const users = await q("SELECT user_id, name, email, role, created_at FROM users ORDER BY user_id");
  return (<>
    <h1>Users</h1><p className="sub">Only admins see this page.</p>
    <ErrorBox error={error} />
    <div className="card"><table><thead><tr><th>Name</th><th>Email</th><th>Role</th><th>Joined</th></tr></thead><tbody>
      {users.map((u: any) => (<tr key={u.user_id}><td>{u.name}</td><td>{u.email}</td>
        <td>{u.user_id === admin.user_id ? u.role : (
          <form action={setUserRoleAction} className="row"><input type="hidden" name="userId" value={u.user_id} />
            <select name="role" defaultValue={u.role}><option>Admin</option><option>Editor</option><option>Viewer</option></select><button className="alt">Set</button></form>)}</td>
        <td className="mute">{fmt(u.created_at)}</td></tr>))}</tbody></table></div>
  </>);
}
