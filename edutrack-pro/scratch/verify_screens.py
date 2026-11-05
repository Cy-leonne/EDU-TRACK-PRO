#!/usr/bin/env python3
"""Screen-contract check for the web frontend.

Every request below is one a *specific screen* in apps/web makes, with the same
query parameters the screen sends. It answers the question the TypeScript
compiler cannot: does each screen's data contract still hold against the running
API? Read-only and idempotent — it creates nothing.

Run:  python3 scratch/verify_screens.py        (API must be listening on :4000)
"""
from __future__ import annotations

import json
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

API = 'http://localhost:4000/api/v1'
TOKENS = Path(__file__).with_name('.screen-tokens.json')

DEMO = {
    'admin': ('admin@nhjs.demo', 'Admin-EduTrack-2026!demo'),
    'teacher': ('teacher@nhjs.demo', 'Teacher-EduTrack-2026!demo'),
    'parent': ('parent@nhjs.demo', 'Parent-EduTrack-2026!demo'),
}
# Access tokens are short-lived by design; the cache keeps the run inside the
# login rate limit (a few logins a minute, not a few dozen).
TOKEN_TTL_SECONDS = 600

failures: list[str] = []
checked = 0


def request(method: str, path: str, token: str | None = None, body: dict | None = None) -> tuple[int, object]:
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(API + path, data=data, method=method)
    req.add_header('Content-Type', 'application/json')
    if token:
        req.add_header('Authorization', f'Bearer {token}')
    try:
        with urllib.request.urlopen(req, timeout=30) as response:
            payload = json.loads(response.read().decode() or 'null')
            return response.status, payload.get('data') if isinstance(payload, dict) and 'data' in payload else payload
    except urllib.error.HTTPError as error:
        raw = error.read().decode()
        try:
            parsed = json.loads(raw)
            return error.code, parsed.get('message', parsed)
        except json.JSONDecodeError:
            return error.code, raw[:200]


def token_for(role: str) -> str:
    cache = json.loads(TOKENS.read_text()) if TOKENS.exists() else {}
    entry = cache.get(role)
    if entry and entry.get('expiresAt', 0) > time.time():
        return entry['token']
    email, password = DEMO[role]
    status, data = request('POST', '/auth/login', body={'email': email, 'password': password, 'clientType': 'WEB'})
    if status != 200 or not isinstance(data, dict):
        raise SystemExit(f'login failed for {role} ({status}): {data}')
    cache[role] = {'token': data['accessToken'], 'user': data.get('user'), 'expiresAt': time.time() + TOKEN_TTL_SECONDS}
    TOKENS.write_text(json.dumps(cache, indent=1))
    return data['accessToken']


def check(screen: str, method: str, path: str, token: str, expect: int = 200, keys: list[str] | None = None):
    global checked
    checked += 1
    status, data = request(method, path, token)
    ok = status == expect
    missing: list[str] = []
    if ok and keys:
        if isinstance(data, dict):
            missing = [key for key in keys if key not in data]
        elif isinstance(data, list):
            missing = [key for key in keys if data and not isinstance(data[0], dict) or (data and key not in data[0])]
            missing = [key for key in keys if data and not isinstance(data[0], dict)]
            if data and isinstance(data[0], dict):
                missing = [key for key in keys if key not in data[0]]
        if missing:
            ok = False
    flag = 'PASS' if ok else 'FAIL'
    detail = ''
    if isinstance(data, list):
        detail = f'list[{len(data)}]'
    elif isinstance(data, dict):
        detail = 'object'
    else:
        detail = repr(data)[:60]
    print(f'{flag}  {status} {method:6} {path[:78]:78} {screen:26} {detail}')
    if not ok:
        note = f'missing keys {missing}' if missing else f'expected {expect}, got {status}'
        print(f'      -> {note}: {str(data)[:200]}')
        failures.append(f'{screen}: {method} {path} ({note})')
    return data


def main() -> int:
    admin = token_for('admin')
    teacher = token_for('teacher')
    parent = token_for('parent')

    # ---------------------------------------------------------------- teacher
    print('\n== teacher screens ==')
    dashboard = check('/teaching/classes', 'GET', '/dashboard/teacher', teacher, keys=['classes', 'learningAreas'])
    check('/teaching/timetable', 'GET', '/timetables/me', teacher, keys=['periods', 'lessons'])
    check('/teaching/assessments', 'GET', '/assessments/dashboard', teacher, keys=['counts'])
    check('/teaching/assessments', 'GET', '/assessments?status=&classId=&search=&pageSize=100', teacher)
    check('/teaching/assessments', 'GET', '/assessments/categories', teacher, keys=['id', 'name'])
    check('/teaching/assessments', 'GET', '/assessments/rubrics', teacher)
    check('/teaching/assessments', 'GET', '/school/academic-years', admin, keys=['id', 'name', 'terms'])
    area_id = (dashboard.get('learningAreas') or [{}])[0].get('id') if isinstance(dashboard, dict) else None
    if area_id:
        check('/teaching/assessments', 'GET', f'/learning-areas/strands?learningAreaId={area_id}', teacher)

    assessments = check('/teaching/assessments/[id]', 'GET', '/assessments?pageSize=100', teacher) or []
    assessment_id = assessments[0]['id'] if isinstance(assessments, list) and assessments else None
    if assessment_id:
        check('/teaching/assessments/[id]', 'GET', f'/assessments/{assessment_id}', teacher, keys=['id', 'title', 'status'])
        grid = check('/teaching/assessments/[id]', 'GET', f'/results/grid/{assessment_id}', teacher, keys=['rows', 'achievementLevels', 'summary'])
    else:
        print('      (no assessments available for the teacher — detail screen not exercised)')

    listing = check('/teaching/submissions', 'GET', '/resources/assignments?pageSize=100', teacher)
    open_assignments = listing if isinstance(listing, list) else []
    # The client strips blank filters before building the URL (api.buildUrl), so an
    # empty picker sends no `status` key at all — which the API's zod query schema
    # requires, since it validates `status` as an enum when present.
    check('/teaching/submissions (no filter)', 'GET', '/submissions?pageSize=100', teacher)
    check('/teaching/submissions (filtered)', 'GET', '/submissions?status=ACCEPTED&pageSize=100', teacher)
    if open_assignments:
        check('/teaching/submissions', 'GET', f"/submissions/summary/{open_assignments[0]['id']}", teacher, keys=['assignment', 'rows', 'completion'])
    check('/teaching/resources', 'GET', '/resources?pageSize=100', teacher)
    check('/teaching/resources', 'GET', '/resources/assignments?pageSize=100', teacher)

    # ----------------------------------------------------------------- parent
    print('\n== parent screens ==')
    parent_dashboard = check('/family', 'GET', '/dashboard/parent', parent, keys=['learners', 'selectedLearnerId', 'latestResults', 'upcomingAssignments'])
    learner_id = parent_dashboard.get('selectedLearnerId') if isinstance(parent_dashboard, dict) else None
    class_id = (parent_dashboard.get('learners') or [{}])[0].get('classId') if isinstance(parent_dashboard, dict) else None
    if learner_id:
        check('/family (child switch)', 'GET', f'/dashboard/parent?learnerId={learner_id}', parent, keys=['selectedLearnerId'])
        check('/family/results', 'GET', f'/results/learner/{learner_id}', parent, keys=['learnerId', 'results'])
        check('/family/results', 'GET', f'/results/learner/{learner_id}/progress', parent)
        check('/family/timetable', 'GET', f'/timetables/learner/{learner_id}', parent, keys=['published', 'periods', 'lessons'])
        check('/family/assignments', 'GET', f'/submissions?learnerId={learner_id}&pageSize=50', parent)
    if class_id:
        check('/family/assignments', 'GET', f'/resources/assignments?classId={class_id}&pageSize=100', parent)
        check('/family/resources', 'GET', f'/resources?classId={class_id}&pageSize=100', parent)
    check('/family/notifications', 'GET', '/notifications?pageSize=50', parent)
    check('/family/notifications', 'GET', '/notifications/preferences', parent, keys=['inAppEnabled', 'emailEnabled', 'mutedTypes'])

    # ------------------------------------------------------------------ admin
    print('\n== admin screens (the ones the new pages touch) ==')
    check('/audit (default)', 'GET', '/audit-logs?action=&entityType=&page=1&pageSize=50', admin)
    check('/audit (filtered)', 'GET', '/audit-logs?action=auth.login&entityType=User&page=1&pageSize=50', admin)
    check('/audit', 'GET', '/audit-logs/actions', admin)
    check('/settings/assessment', 'GET', '/assessments/categories', admin, keys=['id', 'name'])
    check('/settings/assessment', 'GET', '/assessments/achievement-levels', admin)
    check('/settings/assessment', 'GET', '/assessments/rubrics', admin)
    check('/settings/school', 'GET', '/timetables/periods/default', admin, keys=['periods'])
    check('/reports', 'GET', '/reports/school', admin, keys=['enrolmentByGrade', 'assessmentCompletion', 'teacherWorkload', 'timetableCoverage'])

    # ---------------------------------------------------------------- account
    print('\n== account screen ==')
    for role, token in (('admin', admin), ('teacher', teacher), ('parent', parent)):
        check(f'/account ({role})', 'GET', '/auth/me', token, keys=['email', 'role', 'permissions'])
        check(f'/account ({role})', 'GET', '/notifications/preferences', token, keys=['inAppEnabled', 'emailEnabled'])

    print(f'\n{checked - len(failures)}/{checked} screen contracts OK')
    if failures:
        print('\nFAILURES:')
        for failure in failures:
            print(' -', failure)
        return 1
    print('ALL SCREEN CONTRACTS PASSED')
    return 0


if __name__ == '__main__':
    sys.exit(main())
