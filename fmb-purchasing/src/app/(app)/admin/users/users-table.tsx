"use client";

import { SubmitButton } from "@/components/submit-button";
import { ColumnsDataTable, type ColumnDef, type BulkAction } from "@/components/columns-data-table";
import { setUserActive, bulkSetUserActive } from "./actions";

export type UserRow = {
  id: string;
  username: string;
  full_name: string;
  email: string | null;
  teamNames: string;
  is_active: boolean;
};

const COLUMNS: ColumnDef<UserRow>[] = [
  {
    key: "username",
    label: "Username",
    render: (u) => <span className="font-mono">{u.username}</span>,
    exportValue: (u) => u.username,
  },
  { key: "full_name", label: "Full name", render: (u) => u.full_name, exportValue: (u) => u.full_name },
  { key: "email", label: "Contact email", render: (u) => u.email ?? "—", exportValue: (u) => u.email ?? "" },
  { key: "teams", label: "Teams", render: (u) => u.teamNames || "—", exportValue: (u) => u.teamNames },
  {
    key: "status",
    label: "Status",
    render: (u) => <span className={u.is_active ? "text-palm" : "text-maroon/70"}>{u.is_active ? "Active" : "Disabled"}</span>,
    exportValue: (u) => (u.is_active ? "Active" : "Disabled"),
  },
  {
    key: "actions",
    label: "",
    render: (u) => (
      <form action={setUserActive}>
        <input type="hidden" name="user_id" value={u.id} />
        <input type="hidden" name="active" value={String(u.is_active)} />
        <SubmitButton className="text-xs text-ink/60 hover:text-ink">
          {u.is_active ? "Disable" : "Enable"}
        </SubmitButton>
      </form>
    ),
    exportValue: () => "",
  },
];

const BULK_ACTIONS: BulkAction<UserRow>[] = [
  {
    label: "Enable selected",
    onClick: (selected) => bulkSetUserActive(selected.map((u) => u.id), true),
  },
  {
    label: "Disable selected",
    variant: "danger",
    onClick: (selected) => bulkSetUserActive(selected.map((u) => u.id), false),
  },
];

export function UsersTable({ rows, initialVisible }: { rows: UserRow[]; initialVisible: string[] }) {
  return (
    <ColumnsDataTable
      pageKey="admin_users"
      title="Users"
      columns={COLUMNS}
      rows={rows}
      initialVisible={initialVisible}
      emptyLabel="No users yet."
      bulkActions={BULK_ACTIONS}
    />
  );
}
