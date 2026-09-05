import { TableSkeleton } from "@/components/skeleton";

export default function Loading() {
  return <TableSkeleton rows={5} columns={6} />;
}
