'use client';

import { useMemo, useState } from 'react';
import { ExternalLink, Library } from 'lucide-react';
import { useApiQuery } from '@/lib/hooks';
import { useFamily } from '@/lib/family';
import { Badge, Card, CardBody, CardHeader, EmptyState, ErrorState, Input, PageHeader, Select, Skeleton, Td, Th, Table } from '@/components/ui';
import { FileChip } from '@/components/file-upload';
import { colorFor, formatDate, titleCase } from '@/lib/utils';
import type { LearningResource } from '@/lib/types';

/**
 * Resources shared with this child's class.
 *
 * The API filters by the guardian's verified links and the learner's class: a
 * guardian can never see another class's material, and staff-only resources are
 * excluded. Uploaded files open through short-lived authorised links.
 */
export default function FamilyResourcesPage() {
  const family = useFamily();
  const [search, setSearch] = useState('');
  const [type, setType] = useState('');

  const resources = useApiQuery<LearningResource[]>('/resources', { query: { classId: family.learner?.classId, pageSize: 100 } });

  const rows = useMemo(() => {
    const list = resources.data ?? [];
    const needle = search.trim().toLowerCase();
    return list.filter((resource) => {
      if (type && resource.type !== type) return false;
      if (!needle) return true;
      return `${resource.title} ${resource.description ?? ''} ${resource.learningAreaName ?? ''}`.toLowerCase().includes(needle);
    });
  }, [resources.data, search, type]);

  const grouped = useMemo(() => {
    const map = new Map<string, LearningResource[]>();
    for (const row of rows) {
      const key = row.learningAreaName ?? 'General';
      map.set(key, [...(map.get(key) ?? []), row]);
    }
    return Array.from(map.entries());
  }, [rows]);

  return (
    <div className="space-y-4">
      <PageHeader
        title="Learning resources"
        description={`Notes, worksheets and links shared with ${family.learner?.className ?? 'this class'}.`}
      />

      <Card>
        <CardHeader
          title={`${rows.length} resource(s)`}
          description="Newest first, grouped by learning area."
          actions={
            <div className="flex flex-wrap gap-2">
              <Input className="w-full sm:w-56" placeholder="Search resources" value={search} onChange={(event) => setSearch(event.target.value)} aria-label="Search resources" />
              <Select className="w-full sm:w-40" value={type} onChange={(event) => setType(event.target.value)} aria-label="Filter by type">
                <option value="">All types</option>
                <option value="NOTE">Note</option>
                <option value="LINK">Link</option>
                <option value="FILE">File</option>
              </Select>
            </div>
          }
        />
        <CardBody className="space-y-5">
          {resources.loading ? (
            <Skeleton className="h-40" />
          ) : resources.error ? (
            <ErrorState message={resources.error} onRetry={() => resources.reload()} />
          ) : rows.length === 0 ? (
            <EmptyState
              title="Nothing shared yet"
              description="When a teacher shares notes, a worksheet or a link with this class it appears here."
              icon={<Library className="h-6 w-6" aria-hidden />}
            />
          ) : (
            grouped.map(([area, items]) => (
              <section key={area}>
                <h2 className="mb-2 flex items-center gap-2 text-sm font-semibold text-slate-700">
                  <span className="h-3 w-3 rounded-full" style={{ backgroundColor: colorFor(area) }} aria-hidden />
                  {area}
                </h2>
                <ul className="space-y-2">
                  {items.map((resource) => (
                    <li key={resource.id} className="rounded-xl border border-slate-200 p-3">
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="text-sm font-medium text-slate-800">{resource.title}</p>
                          <p className="text-xs text-slate-500">
                            {titleCase(resource.type) ?? 'Resource'}
                            {resource.publishedAt ? ` · shared ${formatDate(resource.publishedAt)}` : ''}
                            {resource.createdByName ? ` · ${resource.createdByName}` : ''}
                          </p>
                        </div>
                        <div className="flex flex-wrap items-center gap-2">
                          <Badge tone="neutral">{resource.learningAreaName ?? 'General'}</Badge>
                          {resource.fileId ? <FileChip fileId={resource.fileId} fileName={resource.fileName ?? 'Download'} /> : null}
                          {resource.externalUrl ? (
                            <a
                              href={resource.externalUrl}
                              target="_blank"
                              rel="noreferrer"
                              className="inline-flex h-8 items-center gap-1 rounded-lg border border-slate-300 px-2.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
                            >
                              <ExternalLink className="h-3.5 w-3.5" aria-hidden /> Open link
                            </a>
                          ) : null}
                        </div>
                      </div>
                      {resource.description ? <p className="mt-2 text-xs text-slate-600">{resource.description}</p> : null}
                      {resource.body ? (
                        <details className="mt-2">
                          <summary className="cursor-pointer text-xs font-medium text-brand">Read the note</summary>
                          <p className="mt-1 whitespace-pre-wrap text-xs text-slate-700">{resource.body}</p>
                        </details>
                      ) : null}
                    </li>
                  ))}
                </ul>
              </section>
            ))
          )}
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="How resources are protected" description="A short note for peace of mind." />
        <CardBody>
          <Table>
            <thead>
              <tr>
                <Th>Protection</Th>
                <Th>What it means for you</Th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <Td className="text-sm text-slate-700">Private storage</Td>
                <Td className="text-xs text-slate-600">Files are not on a public web address. They are only reachable through this portal.</Td>
              </tr>
              <tr>
                <Td className="text-sm text-slate-700">Time-limited links</Td>
                <Td className="text-xs text-slate-600">A download link is generated for you when you click, and expires shortly afterwards.</Td>
              </tr>
              <tr>
                <Td className="text-sm text-slate-700">Class scoping</Td>
                <Td className="text-xs text-slate-600">You can only open resources for classes your linked child is enrolled in.</Td>
              </tr>
            </tbody>
          </Table>
        </CardBody>
      </Card>
    </div>
  );
}
