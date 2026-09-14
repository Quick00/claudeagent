import { PageContainer } from '@/components/shared/PageContainer';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';

/**
 * Loading placeholder for any admin table-shaped list. Mirrors the final
 * layout — gutter and header included — so the page doesn't jump when data
 * arrives and doesn't flash unpadded when it's the route's `loading.tsx`
 * fallback, painted before the panel component (and its own `PageHeader`)
 * has mounted at all.
 *
 * Pass `container={false}` when a panel already renders its own
 * `PageContainer`/`PageHeader` around this (e.g. because another section of
 * the same page loads independently) — that panel supplies the chrome and
 * this component should render just the table.
 */
export function AdminTableSkeleton({
  columns = 5,
  rows = 5,
  container = true,
}: {
  columns?: number;
  rows?: number;
  container?: boolean;
}) {
  const table = (
    <Table>
      <TableHeader>
        <TableRow>
          {Array.from({ length: columns }).map((_, i) => (
            <TableHead key={i}>
              <Skeleton className="h-4 w-20" />
            </TableHead>
          ))}
        </TableRow>
      </TableHeader>
      <TableBody>
        {Array.from({ length: rows }).map((_, r) => (
          <TableRow key={r}>
            {Array.from({ length: columns }).map((_, c) => (
              <TableCell key={c}>
                <Skeleton className="h-4 w-full" />
              </TableCell>
            ))}
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );

  if (!container) return table;

  return (
    <PageContainer>
      <div className="space-y-1" aria-hidden>
        <Skeleton className="h-6 w-40" />
        <Skeleton className="h-4 w-64" />
      </div>
      {table}
    </PageContainer>
  );
}

export default AdminTableSkeleton;
