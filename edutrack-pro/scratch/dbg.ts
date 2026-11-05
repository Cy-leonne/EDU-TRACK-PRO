import { PrismaClient } from '@prisma/client';
import { TimetableGenerator } from '../apps/api/src/modules/timetables/timetable-generator';
import { SCHEDULING_DEFAULTS } from '@edutrack/shared-config';
const prisma = new PrismaClient();
(async () => {
  const school = await prisma.school.findFirstOrThrow({ where: { code: 'NHJS-001' } });
  const periods = await prisma.timetablePeriod.findMany({ where: { schoolId: school.id } });
  const classes = await prisma.class.findMany({ where: { schoolId: school.id } });
  const reqs = await prisma.classLearningAreaRequirement.findMany({ where: { schoolId: school.id }, include: { learningArea: true } });
  const assigns = await prisma.teacherAssignment.findMany({ where: { schoolId: school.id } });
  const teachers = await prisma.teacherProfile.findMany({ where: { schoolId: school.id }, include: { availability: true, user: true } });
  console.log('periods', periods.length, 'teaching', periods.filter(p=>p.isTeaching).length);
  console.log('reqs per class', reqs.length / classes.length, 'total required', reqs.reduce((s,r)=>s+r.periodsPerWeek,0));
  console.log('assignments', assigns.length, 'teachers', teachers.length);
  for (const t of teachers) {
    const my = assigns.filter(a=>a.teacherId===t.id);
    const load = my.reduce((s,a)=> s + (reqs.find(r=>r.classId===a.classId && r.learningAreaId===a.learningAreaId)?.periodsPerWeek ?? 0), 0);
    console.log(t.user.fullName.padEnd(24), 'maxW', t.maxPeriodsPerWeek, 'assignments', my.length, 'needed', load, 'unavail', t.availability.filter(a=>!a.isAvailable).length);
  }
  const gen = new TimetableGenerator({
    periods: periods.map(p=>({id:p.id,dayOfWeek:p.dayOfWeek,sequence:p.sequence,startTime:p.startTime,endTime:p.endTime,isTeaching:p.isTeaching,isBreak:p.isBreak,isLunch:p.isLunch})),
    requirements: reqs.map(r=>({classId:r.classId,className:classes.find(c=>c.id===r.classId)!.name,learningAreaId:r.learningAreaId,learningAreaName:r.learningArea.name,periodsPerWeek:r.periodsPerWeek,preferDoubleLesson:r.preferDoubleLesson,preferMorning:r.preferMorning,requiredRoomId:r.requiredRoomId})),
    assignments: assigns.map(a=>({classId:a.classId,learningAreaId:a.learningAreaId,teacherId:a.teacherId,teacherName:teachers.find(t=>t.id===a.teacherId)!.user.fullName})),
    teachers: teachers.map(t=>({id:t.id,name:t.user.fullName,maxPeriodsPerDay:t.maxPeriodsPerDay,maxPeriodsPerWeek:t.maxPeriodsPerWeek,prefersFreeDays:t.prefersFreeDays,unavailable:t.availability.filter(a=>!a.isAvailable).map(a=>({dayOfWeek:a.dayOfWeek,periodIndex:a.periodIndex})),assignments:assigns.filter(a=>a.teacherId===t.id).map(a=>({classId:a.classId,learningAreaId:a.learningAreaId}))})),
    rooms: [],
    config: { seed: SCHEDULING_DEFAULTS.randomTieBreakSeedDefault, maxConsecutiveSameArea: SCHEDULING_DEFAULTS.maxConsecutivePeriodsPerLearningArea, maxConsecutiveTeacherPeriods: SCHEDULING_DEFAULTS.maxConsecutivePeriodsPerTeacher, maxPeriodsPerDayPerClass: 8, respectTeacherFreeDays: true, useRooms: false, balanceDailyLoad: true, avoidTeacherGaps: true, preferDoubleLessons: false, teacherGapPenalty: SCHEDULING_DEFAULTS.teacherGapPenalty, classGapPenalty: SCHEDULING_DEFAULTS.classGapPenalty, sameSubjectSameDayPenalty: SCHEDULING_DEFAULTS.sameSubjectSameDayPenalty, consecutiveSameSubjectPenalty: SCHEDULING_DEFAULTS.consecutiveSameSubjectPenalty, teacherConsecutivePenalty: SCHEDULING_DEFAULTS.teacherConsecutivePenalty, balanceDailyLoadPenalty: SCHEDULING_DEFAULTS.balanceDailyLoadPenalty, moveStabilityBonus: SCHEDULING_DEFAULTS.moveStabilityBonus, timeBudgetMs: 5000 },
  });
  const res = gen.run();
  const codes: Record<string, number> = {};
  for (const d of res.diagnostics) codes[d.code] = (codes[d.code] ?? 0) + 1;
  console.log('stats', res.stats);
  console.log('codes', codes);
  console.log('samples', res.diagnostics.slice(0,3).map(d=>`${d.code}: ${d.message}`));
  await prisma.$disconnect();
})();
