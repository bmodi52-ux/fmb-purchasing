import type { ActionKey, PageKey } from "@/lib/permissions";

export const NAV_ITEMS: {
  key: PageKey;
  label: string;
  href: string;
  action: ActionKey;
}[] = [
  { key: "submit_expense", label: "Submit expense", href: "/submit", action: "submit" },
  // The quick way onto the Pricelist from a shop floor — see pricelist/add-by-photo.
  { key: "submit_expense", label: "Add item by photo", href: "/pricelist/add-by-photo", action: "submit" },
  { key: "my_submissions", label: "My submissions", href: "/my-submissions", action: "view" },
  { key: "all_expenses", label: "All expenses", href: "/expenses", action: "view" },
  { key: "pricelist", label: "Pricelist", href: "/pricelist", action: "view" },
  { key: "vendors", label: "Vendors", href: "/vendors", action: "view" },
  { key: "approvals", label: "Approvals", href: "/approvals", action: "view" },
  { key: "payments", label: "Payments", href: "/payments", action: "view" },
  { key: "review_queue", label: "Needs attention", href: "/review-queue", action: "view" },
  { key: "reports", label: "Reports", href: "/reports", action: "view" },
  { key: "budgets", label: "Budgets", href: "/budgets", action: "view" },
  { key: "admin_users", label: "Users", href: "/admin/users", action: "manage_users" },
  { key: "admin_teams", label: "Teams & permissions", href: "/admin/teams", action: "manage_teams" },
  // Shares the users-admin grant rather than adding a page key nobody has
  // been granted; whoever administers accounts is who should see breakage.
  { key: "admin_users", label: "System errors", href: "/admin/errors", action: "manage_users" },
  { key: "admin_users", label: "Announcements & alerts", href: "/admin/notifications", action: "manage_users" },
  { key: "admin_users", label: "App settings", href: "/admin/settings", action: "manage_users" },
];
