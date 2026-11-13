import { redirect } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { createDocumentAction } from "../../actions";
import { ErrorBox } from "../../components";
import { SubmitButton } from "../../submit-button";

export default async function NewDocument({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const user = await requireUser();
  if (user.role === "Viewer") redirect("/documents");
  const { error } = await searchParams;
  return (<>
    <h1>New document</h1><p className="sub">Creates the document and its version 1 in one transaction.</p>
    <ErrorBox error={error} />
    <form action={createDocumentAction} className="card">
      <label>Title</label><input name="title" required maxLength={255} />
      <label>Description</label><input name="description" />
      <label>Content</label><textarea name="content" required />
      <p><SubmitButton pending="Creating… (the first save loads the embedding model and can take a while)">Create</SubmitButton></p>
    </form>
  </>);
}
