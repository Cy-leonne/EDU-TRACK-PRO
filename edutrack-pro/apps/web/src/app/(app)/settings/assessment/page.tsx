'use client';

import { CHART_PALETTE } from '@/lib/theme';
import { useMemo, useState } from 'react';
import { ClipboardList, Info, Plus, Trash2 } from 'lucide-react';
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
import { percentRange } from '@/lib/rubric-utils';
import type { AchievementLevel, AssessmentCategory, LearningArea, Rubric } from '@/lib/types';

export default function AssessmentSetupPage() {
  const toast = useToast();
  const [tab, setTab] = useState('categories');
  const categories = useApiQuery<AssessmentCategory[]>('/assessments/categories');
  const levels = useApiQuery<AchievementLevel[]>('/assessments/achievement-levels');
  const rubrics = useApiQuery<Rubric[]>('/assessments/rubrics');
  const areas = useApiQuery<LearningArea[]>('/learning-areas');

  const [categoryModal, setCategoryModal] = useState(false);
  const [levelModal, setLevelModal] = useState(false);
  const [rubricModal, setRubricModal] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [categoryForm, setCategoryForm] = useState({ code: '', name: '', description: '', defaultWeight: '' });
  const [levelForm, setLevelForm] = useState({ code: '', label: '', minPercent: '', maxPercent: '', description: '' });
  const [rubricForm, setRubricForm] = useState({
    title: '',
    description: '',
    learningAreaId: '',
    isTemplate: true,
    criteria: [{ title: '', description: '', maxScore: '5', levels: [{ label: 'Beginning', score: '1', description: '' }, { label: 'Developing', score: '3', description: '' }, { label: 'Proficient', score: '5', description: '' }] }],
  });

  const sortedLevels = useMemo(
    () => (levels.data ?? []).slice().sort((a, b) => Number(a.minPercent) - Number(b.minPercent)),
    [levels.data],
  );

  const saveCategory = async (event: React.FormEvent) => {
    event.preventDefault();
    setPending(true);
    setError(null);
    try {
      await api.post('/assessments/categories', {
        ...categoryForm,
        defaultWeight: categoryForm.defaultWeight ? Number(categoryForm.defaultWeight) : null,
      });
      toast.success('Category created', categoryForm.name);
      setCategoryModal(false);
      setCategoryForm({ code: '', name: '', description: '', defaultWeight: '' });
      await categories.reload();
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'Saving failed.');
    } finally {
      setPending(false);
    }
  };

  const saveLevel = async (event: React.FormEvent) => {
    event.preventDefault();
    setPending(true);
    setError(null);
    try {
      await api.post('/assessments/achievement-levels', {
        ...levelForm,
        minPercent: Number(levelForm.minPercent),
        maxPercent: Number(levelForm.maxPercent),
      });
      toast.success('Achievement band added', levelForm.label);
      setLevelModal(false);
      setLevelForm({ code: '', label: '', minPercent: '', maxPercent: '', description: '' });
      await levels.reload();
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'Saving failed.');
    } finally {
      setPending(false);
    }
  };

  const saveRubric = async (event: React.FormEvent) => {
    event.preventDefault();
    setPending(true);
    setError(null);
    try {
      await api.post('/assessments/rubrics', {
        title: rubricForm.title,
        description: rubricForm.description || null,
        learningAreaId: rubricForm.learningAreaId || null,
        isTemplate: rubricForm.isTemplate,
        criteria: rubricForm.criteria.map((criterion) => ({
          title: criterion.title,
          description: criterion.description || null,
          maxScore: criterion.maxScore ? Number(criterion.maxScore) : null,
          levels: criterion.levels.map((level) => ({ label: level.label, score: Number(level.score), description: level.description || null })),
        })),
      });
      toast.success('Rubric saved', rubricForm.title);
      setRubricModal(false);
      await rubrics.reload();
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'Saving failed.');
    } finally {
      setPending(false);
    }
  };

  const gaps = useMemo(() => {
    const problems: string[] = [];
    if (sortedLevels.length === 0) problems.push('No achievement bands are defined.');
    else {
      if (Number(sortedLevels[0].minPercent) !== 0) problems.push(`The lowest band starts at ${sortedLevels[0].minPercent}%, leaving the bottom of the range uncovered.`);
      if (Number(sortedLevels[sortedLevels.length - 1].maxPercent) < 100) problems.push('The highest band does not reach 100%.');
      for (let index = 1; index < sortedLevels.length; index += 1) {
        const previous = Number(sortedLevels[index - 1].maxPercent);
        const current = Number(sortedLevels[index].minPercent);
        if (Math.abs(current - previous) > 0.05) problems.push(`Gap or overlap between ${sortedLevels[index - 1].label} and ${sortedLevels[index].label}.`);
      }
    }
    if ((categories.data ?? []).length === 0) problems.push('No assessment categories are configured.');
    return problems;
  }, [sortedLevels, categories.data]);

  return (
    <div className="space-y-4">
      <PageHeader
        title="Assessment setup"
        description="Categories, achievement bands and rubrics. Everything here is school-defined — EduTrack ships no national grading scale."
        actions={
          <>
            {tab === 'categories' ? (
              <Button size="sm" onClick={() => setCategoryModal(true)}>
                <Plus className="h-4 w-4" aria-hidden /> New category
              </Button>
            ) : null}
            {tab === 'levels' ? (
              <Button size="sm" onClick={() => setLevelModal(true)}>
                <Plus className="h-4 w-4" aria-hidden /> New band
              </Button>
            ) : null}
            {tab === 'rubrics' ? (
              <Button size="sm" onClick={() => setRubricModal(true)}>
                <Plus className="h-4 w-4" aria-hidden /> New rubric
              </Button>
            ) : null}
          </>
        }
      />

      <Note tone="info" title="Why these are explicitly school-level">
        <p>
          The seeded bands (Below / Approaching / Meeting / Exceeding Expectations) are placeholders a school must review against its own assessment
          policy. They are not official national levels, and EduTrack never computes national outcomes from them.
        </p>
      </Note>

      {gaps.length ? (
        <Note tone="warning" title="Configuration gaps">
          <ul className="list-disc space-y-0.5 pl-4">
            {gaps.map((gap) => (
              <li key={gap}>{gap}</li>
            ))}
          </ul>
        </Note>
      ) : null}

      <Tabs
        value={tab}
        onChange={setTab}
        tabs={[
          { id: 'categories', label: 'Categories', badge: categories.data?.length || undefined },
          { id: 'levels', label: 'Achievement bands', badge: sortedLevels.length || undefined },
          { id: 'rubrics', label: 'Rubrics', badge: rubrics.data?.length || undefined },
        ]}
      />

      {tab === 'categories' ? (
        <Card>
          <CardHeader title="Assessment categories" description="Internal school categories such as CAT, quiz, practical or end-term." />
          <CardBody>
            {categories.loading ? (
              <Skeleton className="h-40" />
            ) : (categories.data ?? []).length === 0 ? (
              <EmptyState title="No categories yet" description="Add at least one category before teachers can create assessments." icon={<ClipboardList className="h-6 w-6" aria-hidden />} />
            ) : (
              <Table>
                <thead>
                  <tr>
                    <Th>Code</Th>
                    <Th>Name</Th>
                    <Th>Description</Th>
                    <Th>Default weight</Th>
                    <Th>Status</Th>
                  </tr>
                </thead>
                <tbody>
                  {categories.data?.map((category) => (
                    <tr key={category.id}>
                      <Td>
                        <code className="rounded bg-slate-100 px-1 py-0.5 text-xs">{category.code}</code>
                      </Td>
                      <Td className="font-medium text-slate-800">{category.name}</Td>
                      <Td className="text-xs text-slate-600">{category.description || '—'}</Td>
                      <Td>{category.defaultWeight ? `${category.defaultWeight}%` : '—'}</Td>
                      <Td>{category.isActive ? <Badge tone="success">active</Badge> : <Badge tone="danger">inactive</Badge>}</Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            )}
            <p className="mt-3 flex items-start gap-2 text-xs text-slate-500">
              <Info className="mt-0.5 h-3.5 w-3.5" aria-hidden />
              Weights are optional and school-defined. If your school does not weight categories, leave them blank — reported results are averages of
              published assessments, not a national score.
            </p>
          </CardBody>
        </Card>
      ) : null}

      {tab === 'levels' ? (
        <Card>
          <CardHeader title="Achievement bands" description="Used when a teacher records an achievement level instead of (or as well as) a mark." />
          <CardBody>
            {levels.loading ? (
              <Skeleton className="h-40" />
            ) : sortedLevels.length === 0 ? (
              <EmptyState title="No achievement bands" description="Add bands that match the school's assessment policy." />
            ) : (
              <Table>
                <thead>
                  <tr>
                    <Th>Code</Th>
                    <Th>Band</Th>
                    <Th>Range</Th>
                    <Th>Description</Th>
                  </tr>
                </thead>
                <tbody>
                  {sortedLevels.map((level) => (
                    <tr key={level.id}>
                      <Td>
                        <code className="rounded bg-slate-100 px-1 py-0.5 text-xs">{level.code}</code>
                      </Td>
                      <Td className="font-medium text-slate-800">{level.label}</Td>
                      <Td>{percentRange(level.minPercent, level.maxPercent)}</Td>
                      <Td className="text-xs text-slate-600">{level.description || '—'}</Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            )}
            <div className="mt-4 h-6 w-full overflow-hidden rounded-full">
              <div className="flex h-full w-full">
                {sortedLevels.map((level) => {
                  const width = Math.max(0, Number(level.maxPercent) - Number(level.minPercent));
                  const palette = CHART_PALETTE;
                  return (
                    <div
                      key={level.id}
                      className="flex items-center justify-center text-[10px] font-medium text-white"
                      style={{ width: `${width}%`, backgroundColor: palette[Math.min(palette.length - 1, sortedLevels.indexOf(level))] }}
                    >
                      {width > 8 ? level.code : ''}
                    </div>
                  );
                })}
              </div>
            </div>
            <p className="mt-1 text-xs text-slate-500">The strip above shows how the school&apos;s bands cover 0–100%.</p>
          </CardBody>
        </Card>
      ) : null}

      {tab === 'rubrics' ? (
        <Card>
          <CardHeader title="Rubrics" description="Reusable criteria sets for practical or project work." />
          <CardBody>
            {rubrics.loading ? (
              <Skeleton className="h-40" />
            ) : (rubrics.data ?? []).length === 0 ? (
              <EmptyState title="No rubrics yet" description="Rubrics are optional — marks alone are fine for most assessments." />
            ) : (
              <div className="space-y-3">
                {rubrics.data?.map((rubric) => (
                  <div key={rubric.id} className="rounded-xl border border-slate-200 p-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div>
                        <p className="text-sm font-semibold text-slate-800">{rubric.title ?? rubric.name}</p>
                        <p className="text-xs text-slate-500">
                          {rubric.criteria?.length ?? 0} criteria
                          {rubric.totalPoints ? ` · ${rubric.totalPoints} points` : ''}
                        </p>
                      </div>
                      {(rubric as unknown as { isTemplate?: boolean }).isTemplate ? <Badge tone="info">template</Badge> : null}
                    </div>
                    <ul className="mt-2 space-y-1 text-xs text-slate-600">
                      {rubric.criteria?.map((criterion) => (
                        <li key={criterion.id ?? criterion.name}>
                          <span className="font-medium">{criterion.name}</span>
                          {criterion.maxPoints ? ` · max ${criterion.maxPoints}` : ''}
                          {criterion.levels?.length ? ` · ${criterion.levels.length} levels` : ''}
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
            )}
          </CardBody>
        </Card>
      ) : null}

      {/* -------------------------------------------------- category modal */}
      <Modal
        open={categoryModal}
        onClose={() => setCategoryModal(false)}
        title="New assessment category"
        size="sm"
        footer={
          <>
            <Button variant="ghost" onClick={() => setCategoryModal(false)}>
              Cancel
            </Button>
            <Button type="submit" form="category-form" loading={pending}>
              Create category
            </Button>
          </>
        }
      >
        <form id="category-form" className="space-y-3" onSubmit={saveCategory}>
          {error ? <ErrorState message={error} /> : null}
          <Field label="Code" required hint="Short unique code, e.g. CAT">
            <Input required value={categoryForm.code} onChange={(event) => setCategoryForm({ ...categoryForm, code: event.target.value.toUpperCase() })} maxLength={16} />
          </Field>
          <Field label="Name" required>
            <Input required value={categoryForm.name} onChange={(event) => setCategoryForm({ ...categoryForm, name: event.target.value })} placeholder="Continuous Assessment Test" />
          </Field>
          <Field label="Description">
            <Textarea value={categoryForm.description} onChange={(event) => setCategoryForm({ ...categoryForm, description: event.target.value })} />
          </Field>
          <Field label="Default weight (%)" hint="Optional and school-defined">
            <Input type="number" min={0} max={100} value={categoryForm.defaultWeight} onChange={(event) => setCategoryForm({ ...categoryForm, defaultWeight: event.target.value })} />
          </Field>
        </form>
      </Modal>

      {/* ----------------------------------------------------- level modal */}
      <Modal
        open={levelModal}
        onClose={() => setLevelModal(false)}
        title="New achievement band"
        description="Bands must not overlap; the checker flags gaps as soon as you save."
        size="sm"
        footer={
          <>
            <Button variant="ghost" onClick={() => setLevelModal(false)}>
              Cancel
            </Button>
            <Button type="submit" form="level-form" loading={pending}>
              Add band
            </Button>
          </>
        }
      >
        <form id="level-form" className="space-y-3" onSubmit={saveLevel}>
          {error ? <ErrorState message={error} /> : null}
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Code" required>
              <Input required value={levelForm.code} onChange={(event) => setLevelForm({ ...levelForm, code: event.target.value.toUpperCase() })} maxLength={8} />
            </Field>
            <Field label="Label" required>
              <Input required value={levelForm.label} onChange={(event) => setLevelForm({ ...levelForm, label: event.target.value })} placeholder="Meeting Expectations" />
            </Field>
            <Field label="From (%)" required>
              <Input type="number" min={0} max={100} step="0.01" required value={levelForm.minPercent} onChange={(event) => setLevelForm({ ...levelForm, minPercent: event.target.value })} />
            </Field>
            <Field label="To (%)" required>
              <Input type="number" min={0} max={100} step="0.01" required value={levelForm.maxPercent} onChange={(event) => setLevelForm({ ...levelForm, maxPercent: event.target.value })} />
            </Field>
          </div>
          <Field label="Description" hint="Shown to teachers choosing a band">
            <Textarea value={levelForm.description} onChange={(event) => setLevelForm({ ...levelForm, description: event.target.value })} />
          </Field>
        </form>
      </Modal>

      {/* ---------------------------------------------------- rubric modal */}
      <Modal
        open={rubricModal}
        onClose={() => setRubricModal(false)}
        title="New rubric"
        description="Each criterion needs at least one level with a score."
        size="lg"
        footer={
          <>
            <Button variant="ghost" onClick={() => setRubricModal(false)}>
              Cancel
            </Button>
            <Button type="submit" form="rubric-form" loading={pending}>
              Save rubric
            </Button>
          </>
        }
      >
        <form id="rubric-form" className="space-y-3" onSubmit={saveRubric}>
          {error ? <ErrorState message={error} /> : null}
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Title" required>
              <Input required value={rubricForm.title} onChange={(event) => setRubricForm({ ...rubricForm, title: event.target.value })} placeholder="Science investigation rubric" />
            </Field>
            <Field label="Learning area">
              <Select value={rubricForm.learningAreaId} onChange={(event) => setRubricForm({ ...rubricForm, learningAreaId: event.target.value })}>
                <option value="">Applies to any area</option>
                {(areas.data ?? []).map((area) => (
                  <option key={area.id} value={area.id}>
                    {area.name}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
          <Field label="Description">
            <Textarea value={rubricForm.description} onChange={(event) => setRubricForm({ ...rubricForm, description: event.target.value })} />
          </Field>
          <Checkbox label="Save as a reusable template" checked={rubricForm.isTemplate} onChange={(event) => setRubricForm({ ...rubricForm, isTemplate: event.target.checked })} />

          <div className="space-y-3">
            {rubricForm.criteria.map((criterion, criterionIndex) => (
              <div key={criterionIndex} className="rounded-xl border border-slate-200 p-3">
                <div className="grid gap-2 sm:grid-cols-[2fr_1fr_auto]">
                  <Field label={`Criterion ${criterionIndex + 1}`} required>
                    <Input
                      required
                      value={criterion.title}
                      onChange={(event) => {
                        const criteria = [...rubricForm.criteria];
                        criteria[criterionIndex] = { ...criterion, title: event.target.value };
                        setRubricForm({ ...rubricForm, criteria });
                      }}
                    />
                  </Field>
                  <Field label="Max score">
                    <Input
                      type="number"
                      min={0}
                      value={criterion.maxScore}
                      onChange={(event) => {
                        const criteria = [...rubricForm.criteria];
                        criteria[criterionIndex] = { ...criterion, maxScore: event.target.value };
                        setRubricForm({ ...rubricForm, criteria });
                      }}
                    />
                  </Field>
                  <div className="flex items-end">
                    <Button
                      type="button"
                      variant="ghost"
                      className="text-rose-700"
                      disabled={rubricForm.criteria.length === 1}
                      onClick={() => setRubricForm({ ...rubricForm, criteria: rubricForm.criteria.filter((_, index) => index !== criterionIndex) })}
                    >
                      <Trash2 className="h-4 w-4" aria-hidden />
                    </Button>
                  </div>
                </div>
                <div className="mt-2 space-y-2">
                  {criterion.levels.map((level, levelIndex) => (
                    <div key={levelIndex} className="grid gap-2 sm:grid-cols-[2fr_1fr]">
                      <Input
                        placeholder="Level label"
                        value={level.label}
                        onChange={(event) => {
                          const criteria = [...rubricForm.criteria];
                          const levels = [...criterion.levels];
                          levels[levelIndex] = { ...level, label: event.target.value };
                          criteria[criterionIndex] = { ...criterion, levels };
                          setRubricForm({ ...rubricForm, criteria });
                        }}
                      />
                      <Input
                        type="number"
                        min={0}
                        placeholder="Score"
                        value={level.score}
                        onChange={(event) => {
                          const criteria = [...rubricForm.criteria];
                          const levels = [...criterion.levels];
                          levels[levelIndex] = { ...level, score: event.target.value };
                          criteria[criterionIndex] = { ...criterion, levels };
                          setRubricForm({ ...rubricForm, criteria });
                        }}
                      />
                    </div>
                  ))}
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    onClick={() => {
                      const criteria = [...rubricForm.criteria];
                      criteria[criterionIndex] = { ...criterion, levels: [...criterion.levels, { label: '', score: '0', description: '' }] };
                      setRubricForm({ ...rubricForm, criteria });
                    }}
                  >
                    <Plus className="h-3.5 w-3.5" aria-hidden /> Add level
                  </Button>
                </div>
              </div>
            ))}
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setRubricForm({ ...rubricForm, criteria: [...rubricForm.criteria, { title: '', description: '', maxScore: '5', levels: [{ label: 'Beginning', score: '1', description: '' }] }] })}
            >
              <Plus className="h-3.5 w-3.5" aria-hidden /> Add criterion
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
