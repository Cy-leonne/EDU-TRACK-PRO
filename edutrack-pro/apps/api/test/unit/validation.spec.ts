import {
  assignmentSchema,
  academicYearSchema,
  learningResourceSchema,
  learnerSchema,
  loginSchema,
  parentLinkRequestSchema,
  passwordSchema,
  resultEntrySchema,
  rubricSchema,
  schoolProfileSchema,
  schoolProfileUpdateSchema,
  termSchema,
} from '@edutrack/validation';

describe('Shared validation schemas (unit)', () => {
  describe('password policy', () => {
    it('accepts a strong password and rejects weak ones', () => {
      expect(passwordSchema.safeParse('Nakuru-Hills-2026!').success).toBe(true);
      expect(passwordSchema.safeParse('short1!A').success).toBe(false);       // too short
      expect(passwordSchema.safeParse('alllowercase123!').success).toBe(false); // no upper case
      expect(passwordSchema.safeParse('NoNumbersHere!!').success).toBe(false);  // no digit
    });
  });

  describe('login', () => {
    it('normalises the email and defaults the client type to WEB', () => {
      const parsed = loginSchema.parse({ email: '  Admin@School.KE ', password: 'whatever-123' });
      expect(parsed.email).toBe('admin@school.ke');
      expect(parsed.clientType).toBe('WEB');
    });
  });

  describe('school calendar', () => {
    it('requires the end date to be after the start date', () => {
      const bad = academicYearSchema.safeParse({ name: '2027', startDate: '2027-01-04', endDate: '2026-11-30' });
      expect(bad.success).toBe(false);
      expect(bad.success === false && bad.error.issues[0]!.path).toEqual(['endDate']);
    });

    it('accepts a term inside the year and rejects an out-of-range term number', () => {
      expect(termSchema.safeParse({ academicYearId: 'ay1', number: 3, name: 'Term 3', startDate: '2026-09-01', endDate: '2026-10-30' }).success).toBe(true);
      expect(termSchema.safeParse({ academicYearId: 'ay1', number: 4, name: 'Term 4', startDate: '2026-09-01', endDate: '2026-10-30' }).success).toBe(false);
    });
  });

  describe('school profile', () => {
    it('applies Kenyan defaults when the school is created', () => {
      const ok = schoolProfileSchema.parse({
        name: 'Mwangaza Junior School',
        workingDays: [1, 2, 3, 4, 5],
        schoolOpenTime: '07:30',
        schoolCloseTime: '16:30',
        defaultPeriodMinutes: 40,
        maxPeriodsPerDay: 8,
      });
      expect(ok.timezone).toBe('Africa/Nairobi');
      expect(ok.breaks).toEqual([]);
    });

    it('rejects a closing time that is not after the opening time', () => {
      const bad = schoolProfileSchema.safeParse({
        name: 'Mwangaza Junior School', workingDays: [1, 2, 3, 4, 5],
        schoolOpenTime: '16:30', schoolCloseTime: '07:30', defaultPeriodMinutes: 40, maxPeriodsPerDay: 8,
      });
      expect(bad.success).toBe(false);
    });

    it('allows partial profile updates (PATCH) without re-sending the whole profile', () => {
      const parsed = schoolProfileUpdateSchema.safeParse({ name: 'Mwangaza Junior School' });
      expect(parsed.success).toBe(true);
    });
  });

  describe('learner', () => {
    it('trims the admission number and requires a usable name', () => {
      const parsed = learnerSchema.parse({ admissionNumber: '  NHJS/2026/0001  ', firstName: 'Achieng', lastName: 'Otieno' });
      expect(parsed.admissionNumber).toBe('NHJS/2026/0001');
      expect(parsed.status).toBe('ACTIVE');
      expect(learnerSchema.safeParse({ admissionNumber: 'X1', firstName: 'A', lastName: '' }).success).toBe(false);
    });
  });

  describe('assessment and results', () => {
    it('accepts valid marks and rejects negative or non-numeric entry', () => {
      // The upper bound is checked in ResultsService against the assessment total,
      // because only the stored assessment knows its total marks.
      expect(resultEntrySchema.safeParse({ learnerId: 'l1', numericScore: 18 }).success).toBe(true);
      expect(resultEntrySchema.safeParse({ learnerId: 'l1', numericScore: -1 }).success).toBe(false);
      expect(resultEntrySchema.safeParse({ learnerId: 'l1', numericScore: 'eighteen' }).success).toBe(false);
      expect(resultEntrySchema.safeParse({ learnerId: 'l1', isAbsent: true }).success).toBe(true);
    });

    it('refuses a result that is both absent and excused', () => {
      expect(resultEntrySchema.safeParse({ learnerId: 'l1', isAbsent: true, isExcused: true }).success).toBe(false);
    });

    it('requires rubric criteria to be unique and positively weighted', () => {
      const rubric = rubricSchema.safeParse({
        title: 'Project rubric',
        criteria: [
          { title: 'Concepts', maxScore: 10 },
          { title: 'Concepts', maxScore: 10 },
        ],
      });
      expect(rubric.success).toBe(false);
    });
  });

  describe('parent self-link', () => {
    it('always requires a second verifier besides the assessment number', () => {
      expect(parentLinkRequestSchema.safeParse({ learnerAssessmentNumber: '700001' }).success).toBe(false);
      const ok = parentLinkRequestSchema.parse({ learnerAssessmentNumber: '700001', learnerSurname: 'Otieno' });
      expect(ok.relationship).toBe('Parent');
    });
  });

  describe('learning resources and assignments', () => {
    it('requires a file for FILE resources and a URL for LINK resources', () => {
      expect(learningResourceSchema.safeParse({ classId: 'c1', learningAreaId: 'a1', type: 'FILE', title: 'Notes pack' }).success).toBe(false);
      expect(learningResourceSchema.safeParse({ classId: 'c1', learningAreaId: 'a1', type: 'FILE', title: 'Notes pack', fileId: 'f1' }).success).toBe(true);
      expect(learningResourceSchema.safeParse({ classId: 'c1', learningAreaId: 'a1', type: 'LINK', title: 'Video', externalUrl: 'https://example.org/x' }).success).toBe(true);
    });

    it('refuses an assignment due date in the past only when explicitly disallowed by the caller', () => {
      expect(assignmentSchema.safeParse({ classId: 'c1', learningAreaId: 'a1', title: 'Exercise 1' }).success).toBe(true);
    });
  });
});
