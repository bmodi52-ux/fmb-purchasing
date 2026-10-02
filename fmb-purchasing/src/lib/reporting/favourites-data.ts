import { cache } from "react";
import { createAdminClient } from "@/lib/supabase/admin";
import { loadFavouriteReports } from "./favourites.ts";

/**
 * Someone's favourite reports, read once for a page. The row of reports, the
 * star beside a report's name and the dashboard's list all ask; they get the
 * one answer.
 */
export const favouriteReportsOf = cache((userId: string) => loadFavouriteReports(createAdminClient(), userId));
