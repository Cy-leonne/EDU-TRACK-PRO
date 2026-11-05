'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { Library, Plus, Rocket, Trash2 } from 'lucide-react';
import { api, ApiError } from '@/lib/api';
import { useApiQuery } from '@/lib/hooks';
import {
  Badge,
  Button,
  Card,
  CardBody,
  CardHeader,
  Checkbox,
  EmptyState,
  ErrorState,
  Field,
  Input,
  Modal,
  Note,
  PageHeader,
  Select,
  Skeleton,
  StatusBadge,
  Table,
  Tabs,
  Td,
  Th,
  Textarea,
  useToast,
} from '@/components/ui';
import { FileChip, FileUpload } from '@/components/file-upload';
import { formatDate, titleCase } from '@/lib/utils';
import type { Assignment, LearningArea, LearningResource } from '@/lib/types';

interface TeacherContext {
  classes: Array<{ id: string; name: string }>;
  learningAreas: LearningArea[];
}

export default function ResourcesPage() {
  const toast = useToast();
  const [tab, setTab] = useState('resources');
  const context = useApiQuery<TeacherContext>('/dashboard/teacher');
  const resources = useApiQuery<LearningResource[]>('/resources', { query: { pageSize: 100 } });
  const assignments = useApiQuery<Assignment[]>('/resources/assignments', { query: { pageSize: 100 } });

  const [resourceModal, setResourceModal] = useState(false);
  const [assignmentModal, setAssignmentModal] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [resourceForm, setResourceForm] = useState({
    title: '',
    description: '',
    type: 'LINK',
    classId: '',
    learningAreaId: '',
    externalUrl: '',
    visibleToParents: true,
    fileId: '',
    fileName: '',
  });

  const [assignmentForm, setAssignmentForm] = useState({
    title: '',
    instructions: '',
    classId: '',
    learningAreaId: '',
    dueDate: '',
    maxScore: '20',
    publishNow: true,
    fileId: '',
    fileName: '',
  });

  const classes = context.data?.classes ?? [];
  const areas = context.data?.learningAreas ?? [];

  const createResource = async (event: React.FormEvent) => {
    event.preventDefault();
    setPending(true);
    setError(null);
    try {
      if (resourceForm.type === 'FILE' && !resourceForm.fileId) {
        setError('Upload a file first, or choose the link type.');
        setPending(false);
        return;
      }
      await api.post('/resources', {
        title: resourceForm.title,
        description: resourceForm.description || null,
        type: resourceForm.type,
        classId: resourceForm.classId || null,
        learningAreaId: resourceForm.learningAreaId || null,
        fileId: resourceForm.type === 'FILE' ? resourceForm.fileId : null,
        externalUrl: resourceForm.type === 'LINK' ? resourceForm.externalUrl : null,
        visibleToParents: resourceForm.visibleToParents,
        publishedAt: resourceForm.visibleToParents ? new Date().toISOString() : null,
      });
      toast.success('Resource shared');
      setResourceModal(false);
      await resources.reload();
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'Could not save the resource.');
    } finally {
      setPending(false);
    }
  };

  const createAssignment = async (event: React.FormEvent) => {
    event.preventDefault();
    setPending(true);
    setError(null);
    try {
      await api.post('/resources/assignments', {
        title: assignmentForm.title,
        instructions: assignmentForm.instructions || null,
        classId: assignmentForm.classId,
        learningAreaId: assignmentForm.learningAreaId,
        dueDate: assignmentForm.dueDate || null,
        maxScore: assignmentForm.maxScore ? Number(assignmentForm.maxScore) : null,
        publishNow: assignmentForm.publishNow,
      });
      toast.success('Assignment created', assignmentForm.publishNow ? 'Guardians can see it and hand work in.' : 'Saved as a draft.');
      setAssignmentModal(false);
      await assignments.reload();
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'Could not create the assignment.');
    } finally {
      setPending(false);
    }
  };

  const removeResource = async (resource: LearningResource) => {
    if (!window.confirm(`Remove “${resource.title}”? It is archived so existing assessment records stay intact.`)) return;
    try {
      await api.del(`/resources/${resource.id}`);
      toast.success('Resource archived');
      await resources.reload();
    } catch (caught) {
      toast.error('Could not archive', caught instanceof ApiError ? caught.message : undefined);
    }
  };

  const publishAssignment = async (assignment: Assignment) => {
    try {
      await api.patch(`/resources/${assignment.id}`, { publishedAt: new Date().toISOString() });
      toast.success('Assignment published', 'Guardians of that class can now see it.');
      await assignments.reload();
    } catch (caught) {
      toast.error('Could not publish', caught instanceof ApiError ? caught.message : undefined);
    }
  };

  const resourceList = resources.data ?? [];
  const assignmentList = useMemo(() => assignments.data ?? [], [assignments.data]);

  return (
    <div className="space-y-4">
      <PageHeader
        title="Resources & assignments"
        description="Share material with a class and set work. Guardians only ever see resources for their own linked learner's class."
        actions={
          <>
            <Button variant="outline" size="sm" onClick={() => setAssignmentModal(true)}>
              <Plus className="h-4 w-4" aria-hidden /> New assignment
            </Button>
            <Button size="sm" onClick={() => setResourceModal(true)}>
              <Plus className="h-4 w-4" aria-hidden /> Share resource
            </Button>
          </>
        }
      />

      <Note tone="info" title="Who sees what">
        <p>
          Resources marked “visible to guardians” appear in the family portal for the class they belong to. Uploaded files are stored privately — guardians open
          them through an authorised link that expires, never a public URL.
        </p>
      </Note>

      <Tabs
        value={tab}
        onChange={setTab}
        tabs={[
          { id: 'resources', label: 'Learning resources', badge: resourceList.length || undefined },
          { id: 'assignments', label: 'Assignments', badge: assignmentList.length || undefined },
        ]}
      />

      {tab === 'resources' ? (
        <Card>
          <CardHeader title="Learning resources" description="Notes, links, past papers and activity sheets." />
          <CardBody>
            {resources.loading ? (
              <Skeleton className="h-40" />
            ) : resources.error ? (
              <ErrorState message={resources.error} onRetry={() => resources.reload()} />
            ) : resourceList.length === 0 ? (
              <EmptyState
                title="Nothing shared yet"
                description="Share notes or a link with one of your classes."
                action={
                  <Button size="sm" onClick={() => setResourceModal(true)}>
                    <Plus className="h-4 w-4" aria-hidden /> Share resource
                  </Button>
                }
                icon={<Library className="h-6 w-6" aria-hidden />}
              />
            ) : (
              <Table>
                <thead>
                  <tr>
                    <Th>Resource</Th>
                    <Th>Class & area</Th>
                    <Th>Type</Th>
                    <Th>Family visibility</Th>
                    <Th>Added</Th>
                    <Th aria-label="Actions" />
                  </tr>
                </thead>
                <tbody>
                  {resourceList.map((resource) => (
                    <tr key={resource.id} className="hover:bg-slate-50">
                      <Td>
                        <span className="block font-medium text-slate-800">{resource.title}</span>
                        {resource.description ? <span className="line-clamp-1 block text-xs text-slate-500">{resource.description}</span> : null}
                        {resource.fileId ? <span className="mt-1 inline-block"><FileChip fileId={resource.fileId} fileName={resource.fileName ?? 'Attachment'} /></span> : null}
                        {resource.externalUrl ? (
                          <a href={resource.externalUrl} target="_blank" rel="noreferrer" className="mt-1 block truncate text-xs text-royal hover:underline">
                            {resource.externalUrl}
                          </a>
                        ) : null}
                      </Td>
                      <Td className="text-xs text-slate-600">
                        {resource.className ?? 'Whole school'}
                        <span className="block text-slate-400">{resource.learningAreaName ?? '—'}</span>
                      </Td>
                      <Td>
                        <Badge tone="neutral">{titleCase(resource.type)}</Badge>
                      </Td>
                      <Td>
                        {resource.visibleToParents ? <Badge tone="success">visible</Badge> : <Badge tone="neutral">staff only</Badge>}
                      </Td>
                      <Td className="text-xs text-slate-500">{formatDate(resource.publishedAt ?? resource.createdAt)}</Td>
                      <Td>
                        <div className="flex justify-end">
                          <Button variant="ghost" size="sm" className="text-rose-700 hover:bg-rose-50" onClick={() => removeResource(resource)} aria-label={`Archive ${resource.title}`}>
                            <Trash2 className="h-4 w-4" aria-hidden />
                          </Button>
                        </div>
                      </Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            )}
          </CardBody>
        </Card>
      ) : null}

      {tab === 'assignments' ? (
        <Card>
          <CardHeader
            title="Assignments"
            description="Set work with a due date. Guardians hand in a photo of the work; you review it in the hand-ins inbox."
            actions={
              <Link href="/teaching/submissions" className="text-xs font-semibold text-royal hover:underline">
                Open hand-ins inbox
              </Link>
            }
          />
          <CardBody>
            {assignments.loading ? (
              <Skeleton className="h-40" />
            ) : assignmentList.length === 0 ? (
              <EmptyState
                title="No assignments yet"
                description="Create one to let guardians hand in work on their child's behalf."
                action={
                  <Button size="sm" onClick={() => setAssignmentModal(true)}>
                    <Plus className="h-4 w-4" aria-hidden /> New assignment
                  </Button>
                }
              />
            ) : (
              <Table>
                <thead>
                  <tr>
                    <Th>Assignment</Th>
                    <Th>Class & area</Th>
                    <Th>Due</Th>
                    <Th>Max score</Th>
                    <Th>Status</Th>
                    <Th aria-label="Actions" />
                  </tr>
                </thead>
                <tbody>
                  {assignmentList.map((assignment) => (
                    <tr key={assignment.id} className="hover:bg-slate-50">
                      <Td>
                        <span className="block font-medium text-slate-800">{assignment.title}</span>
                        {assignment.instructions ? <span className="line-clamp-1 block text-xs text-slate-500">{assignment.instructions}</span> : null}
                      </Td>
                      <Td className="text-xs text-slate-600">
                        {assignment.className}
                        <span className="block text-slate-400">{assignment.learningAreaName}</span>
                      </Td>
                      <Td className="text-xs text-slate-600">{assignment.dueDate ? formatDate(assignment.dueDate) : '—'}</Td>
                      <Td>{assignment.maxScore ?? '—'}</Td>
                      <Td>{assignment.publishedAt ? <StatusBadge status="PUBLISHED" /> : <StatusBadge status="DRAFT" />}</Td>
                      <Td>
                        <div className="flex flex-wrap justify-end gap-1">
                          {!assignment.publishedAt ? (
                            <Button variant="secondary" size="sm" onClick={() => publishAssignment(assignment)}>
                              <Rocket className="h-3.5 w-3.5" aria-hidden /> Publish
                            </Button>
                          ) : null}
                          <Link href="/teaching/submissions" className="inline-flex h-8 items-center rounded-lg px-3 text-xs font-semibold text-royal transition-colors duration-120 hover:bg-royal-soft">
                            Hand-ins
                          </Link>
                        </div>
                      </Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            )}
          </CardBody>
        </Card>
      ) : null}

      {/* ---------------------------------------------------- resource modal */}
      <Modal
        open={resourceModal}
        onClose={() => setResourceModal(false)}
        title="Share a learning resource"
        size="md"
        footer={
          <>
            <Button variant="ghost" onClick={() => setResourceModal(false)}>
              Cancel
            </Button>
            <Button type="submit" form="resource-form" loading={pending}>
              Share resource
            </Button>
          </>
        }
      >
        <form id="resource-form" className="space-y-3" onSubmit={createResource}>
          {error ? <ErrorState message={error} /> : null}
          <Field label="Title" required>
            <Input required value={resourceForm.title} onChange={(event) => setResourceForm({ ...resourceForm, title: event.target.value })} />
          </Field>
          <Field label="Description">
            <Textarea value={resourceForm.description} onChange={(event) => setResourceForm({ ...resourceForm, description: event.target.value })} />
          </Field>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Class" required>
              <Select required value={resourceForm.classId} onChange={(event) => setResourceForm({ ...resourceForm, classId: event.target.value })}>
                <option value="">Select a class</option>
                {classes.map((klass) => (
                  <option key={klass.id} value={klass.id}>
                    {klass.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Learning area">
              <Select value={resourceForm.learningAreaId} onChange={(event) => setResourceForm({ ...resourceForm, learningAreaId: event.target.value })}>
                <option value="">Not specific</option>
                {areas.map((area) => (
                  <option key={area.id} value={area.id}>
                    {area.name}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
          <Field label="Resource type">
            <Select value={resourceForm.type} onChange={(event) => setResourceForm({ ...resourceForm, type: event.target.value })}>
              <option value="LINK">External link</option>
              <option value="FILE">Uploaded file</option>
              <option value="NOTE">Note only</option>
            </Select>
          </Field>
          {resourceForm.type === 'LINK' ? (
            <Field label="Link" required>
              <Input type="url" required value={resourceForm.externalUrl} onChange={(event) => setResourceForm({ ...resourceForm, externalUrl: event.target.value })} placeholder="https://…" />
            </Field>
          ) : null}
          {resourceForm.type === 'FILE' ? (
            <div className="space-y-2">
              <FileUpload
                purpose="RESOURCE"
                label="Upload the resource"
                onUploaded={(file) => setResourceForm({ ...resourceForm, fileId: file.id, fileName: file.fileName })}
                compact
              />
              {resourceForm.fileId ? <FileChip fileId={resourceForm.fileId} fileName={resourceForm.fileName} onRemove={() => setResourceForm({ ...resourceForm, fileId: '', fileName: '' })} /> : null}
            </div>
          ) : null}
          <Checkbox
            label="Visible to guardians of this class"
            checked={resourceForm.visibleToParents}
            onChange={(event) => setResourceForm({ ...resourceForm, visibleToParents: event.target.checked })}
          />
        </form>
      </Modal>

      {/* -------------------------------------------------- assignment modal */}
      <Modal
        open={assignmentModal}
        onClose={() => setAssignmentModal(false)}
        title="New assignment"
        size="md"
        footer={
          <>
            <Button variant="ghost" onClick={() => setAssignmentModal(false)}>
              Cancel
            </Button>
            <Button type="submit" form="assignment-form" loading={pending}>
              Create assignment
            </Button>
          </>
        }
      >
        <form id="assignment-form" className="space-y-3" onSubmit={createAssignment}>
          {error ? <ErrorState message={error} /> : null}
          <Field label="Title" required>
            <Input required value={assignmentForm.title} onChange={(event) => setAssignmentForm({ ...assignmentForm, title: event.target.value })} placeholder="Notes pack exercises 1–10" />
          </Field>
          <Field label="Instructions" hint="Shown to guardians and learners">
            <Textarea value={assignmentForm.instructions} onChange={(event) => setAssignmentForm({ ...assignmentForm, instructions: event.target.value })} />
          </Field>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Class" required>
              <Select required value={assignmentForm.classId} onChange={(event) => setAssignmentForm({ ...assignmentForm, classId: event.target.value })}>
                <option value="">Select a class</option>
                {classes.map((klass) => (
                  <option key={klass.id} value={klass.id}>
                    {klass.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Learning area" required>
              <Select required value={assignmentForm.learningAreaId} onChange={(event) => setAssignmentForm({ ...assignmentForm, learningAreaId: event.target.value })}>
                <option value="">Select a learning area</option>
                {areas.map((area) => (
                  <option key={area.id} value={area.id}>
                    {area.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Due date" hint="Hand-ins after this date are flagged late">
              <Input type="date" value={assignmentForm.dueDate} onChange={(event) => setAssignmentForm({ ...assignmentForm, dueDate: event.target.value })} />
            </Field>
            <Field label="Maximum score">
              <Input type="number" min={0} max={1000} value={assignmentForm.maxScore} onChange={(event) => setAssignmentForm({ ...assignmentForm, maxScore: event.target.value })} />
            </Field>
          </div>
          <Checkbox label="Publish immediately so guardians can see it" checked={assignmentForm.publishNow} onChange={(event) => setAssignmentForm({ ...assignmentForm, publishNow: event.target.checked })} />
        </form>
      </Modal>
    </div>
  );
}
