import type { ActionKey, PageKey } from "@/lib/permissions";

/**
 * The sidebar, in groups (#25). Twenty-odd links in one flat column ran off
 * the bottom of a laptop screen and gave no sense of where anything lived;
 * grouped by the job being done, each list is short enough to take in.
 * Admin folds away, because it is visited rarely and by few.
 */
export const NAV_GROUPS = ["Spend", "Review", "Catalogue", "Kitchen", "Finance", "Admin"] as const;
export type NavGroup = (typeof NAV_GROUPS)[number];

export const NAV_ITEMS: {
  key: PageKey;
  label: string;
  href: string;
  action: ActionKey;
  group: NavGroup;
}[] = [
  { key: "submit_expense", label: "Submit expense", href: "/submit", action: "submit", group: "Spend" },
  // The quick way onto the Pricelist from a shop floor — see pricelist/add-by-photo.
  { key: "submit_expense", label: "Add item by photo or link", href: "/pricelist/add-by-photo", action: "submit", group: "Spend" },
  { key: "my_submissions", label: "My submissions", href: "/my-submissions", action: "view", group: "Spend" },
  { key: "all_expenses", label: "All expenses", href: "/expenses", action: "view", group: "Spend" },
  { key: "approvals", label: "Approvals", href: "/approvals", action: "view", group: "Review" },
  { key: "review_queue", label: "Needs attention", href: "/review-queue", action: "view", group: "Review" },
  { key: "payments", label: "Payments", href: "/payments", action: "view", group: "Review" },
  { key: "pricelist", label: "Pricelist", href: "/pricelist", action: "view", group: "Catalogue" },
  { key: "vendors", label: "Vendors", href: "/vendors", action: "view", group: "Catalogue" },
  // Thaali costing (#70). One entry: the dishes are a tab of it, not a
  // separate place, because a dish only exists to go on a menu.
  { key: "menus", label: "Thaali Calendar", href: "/menus", action: "view", group: "Kitchen" },
  { key: "procurement", label: "Procurement", href: "/procurement", action: "view", group: "Kitchen" },
  // Its own page since 0057: paying and doing the books are different jobs.
  { key: "accounting", label: "Accounting", href: "/accounting", action: "view", group: "Finance" },
  { key: "reports", label: "Reports", href: "/reports", action: "view", group: "Finance" },
  { key: "budgets", label: "Budgets", href: "/budgets", action: "view", group: "Finance" },
  { key: "admin_users", label: "Users", href: "/admin/users", action: "manage_users", group: "Admin" },
  { key: "admin_teams", label: "Teams & permissions", href: "/admin/teams", action: "manage_teams", group: "Admin" },
  // Shares the users-admin grant rather than adding a page key nobody has
  // been granted; whoever administers accounts is who should see breakage.
  { key: "admin_users", label: "System errors", href: "/admin/errors", action: "manage_users", group: "Admin" },
  { key: "announcements", label: "Announcements & alerts", href: "/admin/notifications", action: "view", group: "Admin" },
  { key: "app_settings", label: "App settings", href: "/admin/settings", action: "view", group: "Admin" },
  { key: "records", label: "Backups & records", href: "/admin/records", action: "view", group: "Admin" },
];
