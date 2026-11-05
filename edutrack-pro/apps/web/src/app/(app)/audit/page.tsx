'use client';

import { useState } from 'react';
import { Download, ShieldCheck } from 'lucide-react';
import { api } from '@/lib/api';
import { useApiQuery, useDebounced } from '@/lib/hooks';
import {
  Badge,
  Button,
  Card,
  CardBody,
  CardHeader,
  EmptyState,
  ErrorState,
  Field,
  Input,
  Note,
  PageHeader,
  Select,
  Skeleton,
  Table,
  Td,
  Th,
  useToast,
} from '@/components/ui';
import { formatDateTime, formatRelative } from '@/lib/utils';
import type { AuditLogEntry } from '@/lib/types';

/**
 * Audit log.
 *
 * Every sensitive action writes a row: who did it, to what, and when. The API
 * never stores learner-identifying text in log summaries, so this screen is safe
 * to keep accessible to the school's administrators.
 */
export default function AuditPage() {
  const toast = useToast();
  const [action, setAction] = useState('');
  const [entityType, setEntityType] = useState('');
  const [search, setSearch] = useState('');
  const debounced = useDebounced(search, 300);
  const [page, setPage] = useState(1);

  const actions = useApiQuery<string[]>('/audit-logs/actions');
  // The endpoint returns { items, total, page, pageSize }; the search box filters
  // the current page client-side because the API filters on action/actor/date.
  const logs = useApiQuery<AuditLogEntry[] | { items: AuditLogEntry[]; total: number }>('/audit-logs', {
    query: { action: action || undefined, entityType: entityType || undefined, page, pageSize: 50 },
  });
  const allEntries = Array.isArray(logs.data) ? logs.data : logs.data?.items ?? [];
  const entries = debounced
    ? allEntries.filter((entry) =>
        `${entry.action} ${entry.summary ?? ''} ${entry.actorName ?? ''} ${entry.entityType ?? ''}`.toLowerCase().includes(debounced.toLowerCase()),
      )
    : allEntries;
  const total = Array.isArray(logs.data) ? allEntries.length : logs.data?.total ?? allEntries.length;

  const exportCsv = async () => {
    const rows = entries;
    if (!rows.length) {
      toast.error('Nothing to export', 'Adjust the filters first.');
      return;
    }
    const header = ['timestamp', 'action', 'entityType', 'entityId', 'actor', 'role', 'summary', 'ip'];
    const csv = [
      header.join(','),
      ...rows.map((row) =>
        [row.createdAt, row.action, row.entityType ?? '', row.entityId ?? '', row.actorName ?? '', row.actorRole ?? '', (row.summary ?? '').replace(/"/g, '""'), row.ipAddress ?? '']
          .map((cell) => `"${String(cell)}"`)
          .join(','),
      ),
    ].join('\r\n');
    const url = URL.createObjectURL(new Blob([`\uFEFF${csv}`], { type: 'text/csv;charset=utf-8' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = `audit-log-${new Date().toISOString().slice(0, 10)}.csv`;
    link.click();
    URL.revokeObjectURL(url);
    toast.success('Audit log exported', `${rows.length} row(s) written to CSV.`);
  };

  return (
    <div className="space-y-4">
      <PageHeader
        title="Audit log"
        description="A record of administrative and record-changing actions. Entries cannot be edited or deleted."
        actions={
          <Button size="sm" variant="outline" onClick={exportCsv}>
            <Download className="h-4 w-4" aria-hidden /> Export this page
          </Button>
        }
      />

      <Note tone="info" title="What is recorded">
        <ul className="list-disc space-y-0.5 pl-4">
          <li>Sign-ins, password resets and permission changes.</li>
          <li>Learner, guardian-link and enrolment changes.</li>
          <li>Assessment publication, result amendments (with the reason) and manual timetable edits.</li>
          <li>Every data export, with the file requested.</li>
        </ul>
      </Note>

      <Card>
        <CardHeader
          title={`${entries.length} of ${total} entr${total === 1 ? 'y' : 'ies'}`}
          description="Filter by action, object type or free text."
          actions={
            <div className="flex flex-wrap gap-2">
              <Input className="w-full sm:w-48" placeholder="Search summary" value={search} onChange={(event) => setSearch(event.target.value)} aria-label="Search audit log" />
              <Select className="w-full sm:w-56" value={action} onChange={(event) => setAction(event.target.value)} aria-label="Filter by action">
                <option value="">All actions</option>
                {(actions.data ?? []).map((value) => (
                  <option key={value} value={value}>
                    {value}
                  </option>
                ))}
              </Select>
              <Select className="w-full sm:w-40" value={entityType} onChange={(event) => setEntityType(event.target.value)} aria-label="Filter by entity type">
                <option value="">All objects</option>
                {['Learner', 'Teacher', 'ParentProfile', 'ParentLearnerLink', 'Class', 'ClassEnrollment', 'Assessment', 'AssessmentResult', 'TimetableVersion', 'TimetableEntry', 'User', 'School', 'Export'].map((value) => (
                  <option key={value} value={value}>
                    {value}
                  </option>
                ))}
              </Select>
            </div>
          }
        />
        <CardBody>
          {logs.loading ? (
            <Skeleton className="h-64" />
          ) : logs.error ? (
            <ErrorState message={logs.error} onRetry={() => logs.reload()} />
          ) : entries.length === 0 ? (
            <EmptyState title="No matching entries" description="Try widening the filters." icon={<ShieldCheck className="h-6 w-6" aria-hidden />} />
          ) : (
            <>
              <Table>
                <thead>
                  <tr>
                    <Th>When</Th>
                    <Th>Action</Th>
                    <Th>Actor</Th>
                    <Th>Object</Th>
                    <Th>Summary</Th>
                  </tr>
                </thead>
                <tbody>
                  {entries.map((entry) => (
                    <tr key={entry.id} className="hover:bg-slate-50">
                      <Td>
                        <span className="block text-xs text-slate-700">{formatDateTime(entry.createdAt)}</span>
                        <span className="block text-[11px] text-slate-400">{formatRelative(entry.createdAt)}</span>
                      </Td>
                      <Td>
                        <code className="rounded bg-slate-100 px-1 py-0.5 text-[11px]">{entry.action}</code>
                      </Td>
                      <Td>
                        <span className="block text-xs text-slate-700">{entry.actorName ?? 'System'}</span>
                        {entry.actorRole ? <Badge tone="neutral" className="mt-0.5">{entry.actorRole.toLowerCase()}</Badge> : null}
                      </Td>
                      <Td className="text-xs text-slate-600">
                        {entry.entityType ?? '—'}
                        {entry.entityId ? <span className="block text-[11px] text-slate-400">{entry.entityId.slice(0, 10)}…</span> : null}
                      </Td>
                      <Td className="text-xs text-slate-600">{entry.summary ?? '—'}</Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
              <div className="mt-3 flex items-center justify-between text-xs text-slate-500">
                <span>Page {page}</span>
                <span className="flex gap-2">
                  <Button variant="outline" size="sm" disabled={page === 1} onClick={() => setPage((value) => Math.max(1, value - 1))}>
                    Previous
                  </Button>
                  <Button variant="outline" size="sm" disabled={entries.length < 50} onClick={() => setPage((value) => value + 1)}>
                    Next
                  </Button>
                </span>
              </div>
            </>
          )}
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="Retention" description="How the school should treat this log." />
        <CardBody className="space-y-2 text-xs text-slate-600">
          <p>Audit rows are append-only. Amendment of a published result captures the reason, the previous value and the new value.</p>
          <p>Log text avoids learner names and assessment numbers so the log itself is not a second copy of the learner register.</p>
          <p>For a formal data-protection review, export the pages you need and store them with the school&apos;s other statutory records.</p>
        </CardBody>
      </Card>

      <Field label="Tip">
        <p className="text-xs text-slate-500">
          Looking for a specific learner or assessment? Search by the object type and use the entity id prefix shown in the table; ids are also present in
          exported CSVs.
        </p>
      </Field>
    </div>
  );
}
