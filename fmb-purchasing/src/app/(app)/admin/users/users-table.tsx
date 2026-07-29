"use client";

import { SubmitButton } from "@/components/submit-button";
import { ColumnsDataTable, type ColumnDef, type BulkAction } from "@/components/columns-data-table";
import { setUserActive, bulkSetUserActive } from "./actions";
import { ResetPasswordButton } from "./reset-password-button";

export type UserRow = {
  id: string;
  full_name: string;
  email: string;
  teamNames: string;
  is_active: boolean;
  must_change_password: boolean;
};

const COLUMNS: ColumnDef<UserRow>[] = [
  { key: "full_name", label: "Full name", render: (u) => u.full_name, exportValue: (u) => u.full_name },
  {
    key: "email",
    label: "Email address",
    render: (u) => <span className="font-mono">{u.email}</span>,
    exportValue: (u) => u.email,
  },
  { key: "teams", label: "Teams", render: (u) => u.teamNames || "—", exportValue: (u) => u.teamNames },
  {
    key: "status",
    label: "Status",
    render: (u) =>
      !u.is_active ? (
        <span className="text-maroon/70">Disabled</span>
      ) : u.must_change_password ? (
        <span className="text-ink/60">Password not set</span>
      ) : (
        <span className="text-palm">Active</span>
      ),
    exportValue: (u) =>
      !u.is_active ? "Disabled" : u.must_change_password ? "Password not set" : "Active",
  },
  {
    key: "actions",
    label: "",
    render: (u) => (
      <div className="flex items-center gap-3 whitespace-nowrap">
        <ResetPasswordButton userId={u.id} fullName={u.full_name} />
        <form action={setUserActive}>
          <input type="hidden" name="user_id" value={u.id} />
          <input type="hidden" name="active" value={String(u.is_active)} />
          <SubmitButton className="text-xs text-ink/60 hover:text-ink">
            {u.is_active ? "Disable" : "Enable"}
          </SubmitButton>
        </form>
      </div>
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
