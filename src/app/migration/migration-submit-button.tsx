"use client";

import { LoaderCircle } from "lucide-react";
import { useFormStatus } from "react-dom";

export function MigrationSubmitButton({
  label,
  pendingLabel,
  danger = false,
}: {
  label: string;
  pendingLabel: string;
  danger?: boolean;
}) {
  const { pending } = useFormStatus();

  return (
    <button
      type="submit"
      disabled={pending}
      className={`inline-flex h-11 items-center justify-center gap-2 rounded-md px-4 text-sm font-semibold text-white transition disabled:cursor-wait disabled:opacity-60 ${
        danger ? "bg-red-700 hover:bg-red-600" : "bg-zinc-950 hover:bg-zinc-800"
      }`}
    >
      {pending ? (
        <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden="true" />
      ) : null}
      {pending ? pendingLabel : label}
    </button>
  );
}
