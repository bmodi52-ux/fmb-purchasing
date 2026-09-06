import { TableSkeleton } from "@/components/skeleton";

export default function Loading() {
  return <TableSkeleton rows={10} columns={8} />;
}
