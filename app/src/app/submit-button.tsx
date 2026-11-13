"use client";
import { useFormStatus } from "react-dom";

/** Submit button that disables itself while its form's server action is running (prevents double submits). */
export function SubmitButton({ children, pending: pendingText = "Saving…" }: { children: React.ReactNode; pending?: string }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending} aria-busy={pending}>
      {pending ? pendingText : children}
    </button>
  );
}
