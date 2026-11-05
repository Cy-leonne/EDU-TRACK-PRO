'use client';

import { BRAND_DEFAULTS } from '@/lib/theme';
import { useMemo, useState } from 'react';
import { Layers, ListTree, Pencil, Plus, Sparkles, Trash2 } from 'lucide-react';
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
  Table,
  Tabs,
  Td,
  Th,
  Textarea,
  useToast,
} from '@/components/ui';
import { colorFor, contrastText } from '@/lib/utils';
import type { ClassSummary, LearningArea, PeriodRequirement, Strand } from '@/lib/types';

export default function LearningAreasPage() {
  const toast = useToast();
  const [tab, setTab] = useState('areas');
  const areas = useApiQuery<LearningArea[]>('/learning-areas');
  const classes = useApiQuery<ClassSummary[]>('/classes', { query: { pageSize: 100 } });
  const requirements = useApiQuery<PeriodRequirement[]>('/learning-areas/requirements');

  const [selectedArea, setSelectedArea] = useState<LearningArea | null>(null);
  const strands = useApiQuery<Strand[]>(selectedArea ? '/learning-areas/strands' : null, { query: selectedArea ? { learningAreaId: selectedArea.id } : undefined });

  const [editing, setEditing] = useState<LearningArea | null>(null);
  const [creating, setCreating] = useState(false);
  const [pending, setPending] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [form, setForm] = useState({ code: '', name: '', shortName: '', colorHex: BRAND_DEFAULTS.accent, description: '', isCore: false, isExamined: true, defaultPeriodsPerWeek: '4' });

  const [strandModal, setStrandModal] = useState(false);
  const [subStrandFor, setSubStrandFor] = useState<Strand | null>(null);

  const [requirementForm, setRequirementForm] = useState({ classId: '', learningAreaId: '', periodsPerWeek: '4', preferDoubleLesson: false, preferMorning: false });

  const areaList = useMemo(() => areas.data ?? [], [areas.data]);
  const totalRequired = (requirements.data ?? []).reduce((sum, item) => sum + item.periodsPerWeek, 0);

  const saveArea = async (event: React.FormEvent) => {
    event.preventDefault();
    setPending(true);
    setFormError(null);
    const payload = {
      ...form,
      shortName: form.shortName || null,
      description: form.description || null,
      defaultPeriodsPerWeek: form.defaultPeriodsPerWeek ? Number(form.defaultPeriodsPerWeek) : null,
    };
    try {
      if (editing) {
        await api.patch(`/learning-areas/${editing.id}`, payload);
        toast.success('Learning area updated', form.name);
      } else {
        await api.post('/learning-areas', payload);
        toast.success('Learning area added', form.name);
      }
      setCreating(false);
      setEditing(null);
      await areas.reload();
    } catch (caught) {
      setFormError(caught instanceof ApiError ? caught.message : 'Saving failed.');
    } finally {
      setPending(false);
    }
  };

  const seedTemplate = async () => {
    if (!window.confirm('Add the standard junior school learning areas that are not present yet?')) return;
    try {
      const result = await api.post<{ created: number; skipped: number }>('/learning-areas/import-template', {});
      toast.success('Learning areas imported', `${result?.created ?? 0} added, ${result?.skipped ?? 0} already existed.`);
      await areas.reload();
    } catch (caught) {
      toast.error('Import failed', caught instanceof ApiError ? caught.message : undefined);
    }
  };

  const saveStrand = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    setPending(true);
    try {
      await api.post('/learning-areas/strands', {
        learningAreaId: selectedArea?.id,
        name: data.get('name'),
        description: data.get('description') || null,
        order: Number(data.get('order') ?? 0),
      });
      toast.success('Strand added');
      setStrandModal(false);
      await strands.reload();
      await areas.reload();
    } catch (caught) {
      toast.error('Could not add the strand', caught instanceof ApiError ? caught.message : undefined);
    } finally {
      setPending(false);
    }
  };

  const saveSubStrand = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    setPending(true);
    try {
      await api.post('/learning-areas/sub-strands', {
        strandId: subStrandFor?.id,
        name: data.get('name'),
        description: data.get('description') || null,
        order: Number(data.get('order') ?? 0),
      });
      toast.success('Sub-strand added');
      setSubStrandFor(null);
      await strands.reload();
    } catch (caught) {
      toast.error('Could not add the sub-strand', caught instanceof ApiError ? caught.message : undefined);
    } finally {
      setPending(false);
    }
  };

  const saveRequirement = async (event: React.FormEvent) => {
    event.preventDefault();
    setPending(true);
    try {
      await api.post('/learning-areas/requirements', {
        ...requirementForm,
        periodsPerWeek: Number(requirementForm.periodsPerWeek),
      });
      toast.success('Weekly requirement saved');
      setRequirementForm({ ...requirementForm, classId: '' });
      await requirements.reload();
    } catch (caught) {
      toast.error('Could not save the requirement', caught instanceof ApiError ? caught.message : undefined);
    } finally {
      setPending(false);
    }
  };

  const deleteRequirement = async (item: PeriodRequirement) => {
    try {
      await api.del(`/learning-areas/requirements/${item.id}`);
      toast.success('Requirement removed');
      await requirements.reload();
    } catch (caught) {
      toast.error('Could not remove', caught instanceof ApiError ? caught.message : undefined);
    }
  };

  const deleteArea = async (area: LearningArea) => {
    if (!window.confirm(`Remove ${area.name}? It is archived rather than deleted, so historical assessment records stay intact.`)) return;
    try {
      await api.del(`/learning-areas/${area.id}`);
      toast.success('Learning area archived', area.name);
      await areas.reload();
    } catch (caught) {
      toast.error('Could not archive', caught instanceof ApiError ? caught.message : undefined);
    }
  };

  return (
    <div className="space-y-4">
      <PageHeader
        title="Learning areas, strands & periods"
        description="Learning areas for Grades 7–9 with their strands, sub-strands and the weekly lesson requirement used by the timetable engine."
        actions={
          <>
            <Button variant="outline" size="sm" onClick={seedTemplate}>
              <Sparkles className="h-4 w-4" aria-hidden /> Add standard areas
            </Button>
            <Button
              size="sm"
              onClick={() => {
                setForm({ code: '', name: '', shortName: '', colorHex: BRAND_DEFAULTS.accent, description: '', isCore: false, isExamined: true, defaultPeriodsPerWeek: '4' });
                setCreating(true);
              }}
            >
              <Plus className="h-4 w-4" aria-hidden /> New learning area
            </Button>
          </>
        }
      />

      <Note tone="info" title="Curriculum terminology, school-level rules">
        <p>
          Strands and sub-strands track the competency-based curriculum. Achievement bands and any weightings are set by the school — EduTrack never applies
          national grading thresholds.
        </p>
      </Note>

      <Tabs
        value={tab}
        onChange={setTab}
        tabs={[
          { id: 'areas', label: 'Learning areas', badge: areaList.length || undefined },
          { id: 'requirements', label: 'Weekly periods', badge: requirements.data?.length || undefined },
        ]}
      />

      {tab === 'areas' ? (
        <div className="grid gap-4 lg:grid-cols-[2fr_1fr]">
          <Card>
            <CardHeader title="Learning areas" description="Colours are used across the timetable and progress charts." />
            <CardBody>
              {areas.loading ? (
                <Skeleton className="h-40" />
              ) : areas.error ? (
                <ErrorState message={areas.error} onRetry={() => areas.reload()} />
              ) : areaList.length === 0 ? (
                <EmptyState
                  title="No learning areas yet"
                  description="Add the areas taught at this school, or start from the standard list."
                  action={
                    <Button size="sm" onClick={seedTemplate}>
                      <Sparkles className="h-4 w-4" aria-hidden /> Add standard areas
                    </Button>
                  }
                  icon={<Layers className="h-6 w-6" aria-hidden />}
                />
              ) : (
                <Table>
                  <thead>
                    <tr>
                      <Th>Learning area</Th>
                      <Th>Code</Th>
                      <Th>Strands</Th>
                      <Th>Weekly periods set</Th>
                      <Th>Assessments</Th>
                      <Th>Flags</Th>
                      <Th aria-label="Actions" />
                    </tr>
                  </thead>
                  <tbody>
                    {areaList.map((area) => {
                      const color = colorFor(area.name, area.colorHex);
                      return (
                        <tr key={area.id} className="hover:bg-slate-50">
                          <Td>
                            <span className="flex items-center gap-2">
                              <span className="h-4 w-4 rounded" style={{ backgroundColor: color }} aria-hidden />
                              <span>
                                <span className="block font-medium text-slate-800">{area.name}</span>
                                {area.shortName ? <span className="block text-xs text-slate-500">{area.shortName}</span> : null}
                              </span>
                            </span>
                          </Td>
                          <Td>
                            <code className="rounded bg-slate-100 px-1 py-0.5 text-xs">{area.code}</code>
                          </Td>
                          <Td>{area.strandCount ?? 0}</Td>
                          <Td>
                            {area.requirementCount ? (
                              <Badge tone="info">{area.requirementCount} class(es)</Badge>
                            ) : area.defaultPeriodsPerWeek ? (
                              <span className="text-xs text-slate-500">default {area.defaultPeriodsPerWeek}</span>
                            ) : (
                              <span className="text-xs text-slate-400">not set</span>
                            )}
                          </Td>
                          <Td>{area.assessmentCount ?? 0}</Td>
                          <Td>
                            <div className="flex flex-wrap gap-1">
                              {area.isCore ? <Badge tone="info">core</Badge> : null}
                              {area.isExamined ? <Badge tone="neutral">examined</Badge> : null}
                              {area.isActive ? null : <Badge tone="danger">archived</Badge>}
                            </div>
                          </Td>
                          <Td>
                            <div className="flex justify-end gap-1">
                              <Button variant="ghost" size="sm" onClick={() => setSelectedArea(area)} aria-label={`Manage strands for ${area.name}`}>
                                <ListTree className="h-4 w-4" aria-hidden />
                              </Button>
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => {
                                  setEditing(area);
                                  setForm({
                                    code: area.code,
                                    name: area.name,
                                    shortName: area.shortName ?? '',
                                    colorHex: area.colorHex,
                                    description: area.description ?? '',
                                    isCore: area.isCore,
                                    isExamined: area.isExamined,
                                    defaultPeriodsPerWeek: String(area.defaultPeriodsPerWeek ?? ''),
                                  });
                                }}
                                aria-label={`Edit ${area.name}`}
                              >
                                <Pencil className="h-4 w-4" aria-hidden />
                              </Button>
                              <Button variant="ghost" size="sm" className="text-rose-700 hover:bg-rose-50" onClick={() => deleteArea(area)} aria-label={`Archive ${area.name}`}>
                                <Trash2 className="h-4 w-4" aria-hidden />
                              </Button>
                            </div>
                          </Td>
                        </tr>
                      );
                    })}
                  </tbody>
                </Table>
              )}
            </CardBody>
          </Card>

          <Card>
            <CardHeader
              title={selectedArea ? `Strands · ${selectedArea.name}` : 'Strands'}
              description={selectedArea ? 'Sub-strands hang under each strand and are used when creating assessments.' : 'Select a learning area to manage its strands.'}
              actions={
                selectedArea ? (
                  <Button size="sm" variant="outline" onClick={() => setStrandModal(true)}>
                    <Plus className="h-4 w-4" aria-hidden /> Strand
                  </Button>
                ) : null
              }
            />
            <CardBody>
              {!selectedArea ? (
                <EmptyState title="Nothing selected" description="Choose a learning area from the table to see its strands." />
              ) : strands.loading ? (
                <Skeleton className="h-32" />
              ) : (strands.data ?? []).length === 0 ? (
                <EmptyState
                  title="No strands yet"
                  description={`Add the first strand for ${selectedArea.name}.`}
                  action={
                    <Button size="sm" onClick={() => setStrandModal(true)}>
                      <Plus className="h-4 w-4" aria-hidden /> Add strand
                    </Button>
                  }
                />
              ) : (
                <ul className="space-y-2">
                  {strands.data?.map((strand) => (
                    <li key={strand.id} className="rounded-lg border border-slate-100 px-3 py-2">
                      <div className="flex items-start justify-between gap-2">
                        <span className="min-w-0">
                          <span className="block text-sm font-medium text-slate-800">{strand.name}</span>
                          {strand.description ? <span className="block text-xs text-slate-500">{strand.description}</span> : null}
                        </span>
                        <Button variant="ghost" size="sm" onClick={() => setSubStrandFor(strand)}>
                          <Plus className="h-3.5 w-3.5" aria-hidden /> Sub
                        </Button>
                      </div>
                      {strand.subStrands?.length ? (
                        <ul className="mt-2 space-y-0.5 border-l-2 border-slate-100 pl-3">
                          {strand.subStrands.map((sub) => (
                            <li key={sub.id} className="text-xs text-slate-600">
                              {sub.name}
                            </li>
                          ))}
                        </ul>
                      ) : (
                        <p className="mt-1 text-xs text-slate-400">No sub-strands yet</p>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </CardBody>
          </Card>
        </div>
      ) : null}

      {tab === 'requirements' ? (
        <div className="grid gap-4 lg:grid-cols-[1fr_2fr]">
          <Card>
            <CardHeader title="Set a weekly requirement" description="Per class and learning area. The engine must schedule exactly these periods." />
            <CardBody>
              <form className="space-y-3" onSubmit={saveRequirement}>
                <Field label="Class" required>
                  <Select required value={requirementForm.classId} onChange={(event) => setRequirementForm({ ...requirementForm, classId: event.target.value })}>
                    <option value="">Select a class</option>
                    {(classes.data ?? []).map((klass) => (
                      <option key={klass.id} value={klass.id}>
                        {klass.name}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label="Learning area" required>
                  <Select required value={requirementForm.learningAreaId} onChange={(event) => setRequirementForm({ ...requirementForm, learningAreaId: event.target.value })}>
                    <option value="">Select a learning area</option>
                    {areaList.map((area) => (
                      <option key={area.id} value={area.id}>
                        {area.name}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label="Periods per week" required hint="Between 1 and 20">
                  <Input
                    type="number"
                    min={1}
                    max={20}
                    required
                    value={requirementForm.periodsPerWeek}
                    onChange={(event) => setRequirementForm({ ...requirementForm, periodsPerWeek: event.target.value })}
                  />
                </Field>
                <div className="space-y-2">
                  <Checkbox
                    label="Prefer double lessons where possible"
                    checked={requirementForm.preferDoubleLesson}
                    onChange={(event) => setRequirementForm({ ...requirementForm, preferDoubleLesson: event.target.checked })}
                  />
                  <Checkbox
                    label="Prefer morning periods"
                    checked={requirementForm.preferMorning}
                    onChange={(event) => setRequirementForm({ ...requirementForm, preferMorning: event.target.checked })}
                  />
                </div>
                <Button type="submit" loading={pending} className="w-full">
                  Save requirement
                </Button>
              </form>
            </CardBody>
          </Card>

          <Card>
            <CardHeader
              title="Weekly lesson requirements"
              description={`${requirements.data?.length ?? 0} requirement(s) · ${totalRequired} periods per week in total`}
            />
            <CardBody>
              {requirements.loading ? (
                <Skeleton className="h-40" />
              ) : (requirements.data ?? []).length === 0 ? (
                <EmptyState title="No requirements set" description="Without these the timetable engine cannot know how many lessons each class needs." />
              ) : (
                <Table>
                  <thead>
                    <tr>
                      <Th>Class</Th>
                      <Th>Learning area</Th>
                      <Th>Periods/week</Th>
                      <Th>Preferences</Th>
                      <Th aria-label="Actions" />
                    </tr>
                  </thead>
                  <tbody>
                    {(requirements.data ?? []).map((item) => (
                      <tr key={item.id}>
                        <Td>{item.className}</Td>
                        <Td>
                          <span className="flex items-center gap-2">
                            <span className="h-3 w-3 rounded" style={{ backgroundColor: colorFor(item.learningAreaName, item.learningAreaColor) }} aria-hidden />
                            {item.learningAreaName}
                          </span>
                        </Td>
                        <Td className="font-medium">{item.periodsPerWeek}</Td>
                        <Td>
                          <div className="flex flex-wrap gap-1">
                            {item.preferDoubleLesson ? <Badge tone="info">double</Badge> : null}
                            {item.preferMorning ? <Badge tone="neutral">morning</Badge> : null}
                          </div>
                        </Td>
                        <Td>
                          <div className="flex justify-end">
                            <Button variant="ghost" size="sm" className="text-rose-700 hover:bg-rose-50" onClick={() => deleteRequirement(item)} aria-label="Remove requirement">
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
        </div>
      ) : null}

      {/* ------------------------------------------------------- area modal */}
      <Modal
        open={creating || Boolean(editing)}
        onClose={() => {
          setCreating(false);
          setEditing(null);
        }}
        title={editing ? `Edit ${editing.name}` : 'Add a learning area'}
        size="md"
        footer={
          <>
            <Button
              variant="ghost"
              onClick={() => {
                setCreating(false);
                setEditing(null);
              }}
            >
              Cancel
            </Button>
            <Button type="submit" form="area-form" loading={pending}>
              {editing ? 'Save changes' : 'Add learning area'}
            </Button>
          </>
        }
      >
        <form id="area-form" className="grid gap-3 sm:grid-cols-2" onSubmit={saveArea}>
          {formError ? (
            <div className="sm:col-span-2">
              <ErrorState message={formError} />
            </div>
          ) : null}
          <Field label="Name" required>
            <Input required value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} placeholder="Integrated Science" />
          </Field>
          <Field label="Code" required hint="Short unique code, e.g. SCI">
            <Input required value={form.code} onChange={(event) => setForm({ ...form, code: event.target.value.toUpperCase() })} maxLength={16} />
          </Field>
          <Field label="Short name">
            <Input value={form.shortName} onChange={(event) => setForm({ ...form, shortName: event.target.value })} placeholder="Sci" />
          </Field>
          <Field label="Colour">
            <span className="flex items-center gap-2">
              <input
                type="color"
                value={form.colorHex}
                onChange={(event) => setForm({ ...form, colorHex: event.target.value })}
                className="h-10 w-14 rounded border border-slate-300"
                aria-label="Colour"
              />
              <span className="rounded px-2 py-1 text-xs" style={{ backgroundColor: form.colorHex, color: contrastText(form.colorHex) }}>
                {form.colorHex}
              </span>
            </span>
          </Field>
          <Field label="Default periods per week" hint="Used as a starting point for class requirements">
            <Input
              type="number"
              min={1}
              max={20}
              value={form.defaultPeriodsPerWeek}
              onChange={(event) => setForm({ ...form, defaultPeriodsPerWeek: event.target.value })}
            />
          </Field>
          <Field label="Description" className="sm:col-span-2">
            <Textarea value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} />
          </Field>
          <div className="space-y-2 sm:col-span-2">
            <Checkbox label="Core learning area" checked={form.isCore} onChange={(event) => setForm({ ...form, isCore: event.target.checked })} />
            <Checkbox label="Included in school assessment reporting" checked={form.isExamined} onChange={(event) => setForm({ ...form, isExamined: event.target.checked })} />
          </div>
        </form>
      </Modal>

      {/* ----------------------------------------------------- strand modal */}
      <Modal
        open={strandModal}
        onClose={() => setStrandModal(false)}
        title={`Add a strand to ${selectedArea?.name ?? ''}`}
        size="sm"
        footer={
          <>
            <Button variant="ghost" onClick={() => setStrandModal(false)}>
              Cancel
            </Button>
            <Button type="submit" form="strand-form" loading={pending}>
              Add strand
            </Button>
          </>
        }
      >
        <form id="strand-form" className="space-y-3" onSubmit={saveStrand}>
          <Field label="Strand name" required>
            <Input name="name" required placeholder="Numbers" />
          </Field>
          <Field label="Description">
            <Textarea name="description" />
          </Field>
          <Field label="Display order">
            <Input name="order" type="number" min={0} defaultValue={0} />
          </Field>
        </form>
      </Modal>

      <Modal
        open={Boolean(subStrandFor)}
        onClose={() => setSubStrandFor(null)}
        title={`Add a sub-strand to ${subStrandFor?.name ?? ''}`}
        size="sm"
        footer={
          <>
            <Button variant="ghost" onClick={() => setSubStrandFor(null)}>
              Cancel
            </Button>
            <Button type="submit" form="substrand-form" loading={pending}>
              Add sub-strand
            </Button>
          </>
        }
      >
        <form id="substrand-form" className="space-y-3" onSubmit={saveSubStrand}>
          <Field label="Sub-strand name" required>
            <Input name="name" required placeholder="Whole numbers up to 100,000" />
          </Field>
          <Field label="Description">
            <Textarea name="description" />
          </Field>
          <Field label="Display order">
            <Input name="order" type="number" min={0} defaultValue={0} />
          </Field>
        </form>
      </Modal>
    </div>
  );
}
