import json, urllib.request, urllib.error, sys

BASE = 'http://localhost:4000/api/v1'

def call(method, path, token=None, body=None, expect=None, label=''):
    req = urllib.request.Request(BASE + path, method=method)
    req.add_header('Content-Type', 'application/json')
    if token: req.add_header('Authorization', f'Bearer {token}')
    data = json.dumps(body).encode() if body is not None else None
    try:
        with urllib.request.urlopen(req, data, timeout=30) as r:
            code, payload = r.status, json.loads(r.read() or b'{}')
    except urllib.error.HTTPError as e:
        code, payload = e.code, json.loads(e.read() or b'{}')
    # 401 and 403 are both correct "denied" answers: 401 = missing permission, 403 = not your record.
    ok = (expect is None) or (code == expect) or (expect in (401, 403) and code in (401, 403))
    detail = ''
    d = payload.get('data')
    if isinstance(d, dict):
        keys = list(d.keys())[:6]
        detail = f"keys={keys}"
    elif isinstance(d, list):
        detail = f"items={len(d)}"
    print(f"{'PASS' if ok else 'FAIL'}  {code:3} {method:6} {path:52} {label} {detail}")
    if not ok:
        print('      ->', json.dumps(payload)[:300])
    return payload

import os, time
CACHE = 'scratch/.tokens.json'
def login(email, password):
    # Login rate limiting is intentionally strict (8/60s), so reuse tokens when they are fresh.
    cache = json.load(open(CACHE)) if os.path.exists(CACHE) else {}
    entry = cache.get(email)
    if entry and entry.get('expires_at', 0) > time.time():
        print(f"PASS  ---  POST   /auth/login                                          {email} (cached token)")
        return entry['token'], entry['user']
    r = call('POST', '/auth/login', body={'email': email, 'password': password, 'clientType': 'MOBILE'}, expect=200, label=email)
    if 'data' not in r:
        raise SystemExit('login failed - see response above (rate limited? wait 60s)')
    cache[email] = {'token': r['data']['accessToken'], 'user': r['data'], 'expires_at': time.time() + 600}
    json.dump(cache, open(CACHE, 'w'))
    return r['data']['accessToken'], r['data']

admin, admin_user = login('admin@nhjs.demo', 'Admin-EduTrack-2026!demo')
teacher, teacher_user = login('teacher@nhjs.demo', 'Teacher-EduTrack-2026!demo')
parent, parent_user = login('parent@nhjs.demo', 'Parent-EduTrack-2026!demo')

print('\n-- admin --')
adm = call('GET', '/dashboard/admin', admin, expect=200, label='admin dashboard')
print('      learners:', adm['data']['counts'].get('learners'), 'timetable:', json.dumps(adm['data'].get('timetable'))[:120])
call('GET', '/school/terms', admin, expect=200, label='terms')
call('GET', '/school/grades', admin, expect=200, label='grades')
classes = call('GET', '/classes?pageSize=10', admin, expect=200, label='classes')
areas = call('GET', '/learning-areas', admin, expect=200, label='learning areas')
tt = call('GET', '/timetables?academicYearId=&termId=', admin, expect=200, label='timetables')
pre = call('GET', '/timetables/preflight', admin, expect=200, label='preflight')
print('      preflight ready:', pre['data'].get('ready'), 'teachingSlots:', pre['data'].get('teachingSlotCount'))
tt_items = tt['data'] if isinstance(tt['data'], list) else tt['data']['items']
vid = tt_items[0]['currentVersionId']
call('GET', f'/timetables/versions/{vid}', admin, expect=200, label='version view')
grid = call('GET', f'/timetables/versions/{vid}/school-grid', admin, expect=200, label='school grid')
print('      grid lessons:', sum(len(c['lessons']) for c in grid['data']['classes']))
call('GET', '/reports/school', admin, expect=200, label='school report')
call('GET', '/audit-logs?pageSize=5', admin, expect=200, label='audit trail')
call('GET', '/teacher-assignments/coverage', admin, expect=200, label='coverage check')
call('GET', '/assessments/dashboard', admin, expect=200, label='assessment dashboard')

print('\n-- teacher --')
tch = call('GET', '/dashboard/teacher', teacher, expect=200, label='teacher dashboard')
print('      today lessons:', len(tch['data'].get('today', [])), 'weeklyLoad:', json.dumps(tch['data'].get('weeklyLoad'))[:100])
call('GET', '/timetables/me', teacher, expect=200, label='my timetable')
call('GET', '/teacher-assignments/me', teacher, expect=200, label='my assignments')
alist = call('GET', '/assessments?pageSize=50', teacher, expect=200, label='assessments (teacher scope)')
a_items = alist['data'] if isinstance(alist['data'], list) else alist['data']['items']
a_id = None
for item in a_items:
    if item['status'] in ('DRAFT', 'READY_FOR_REVIEW'): a_id = item['id']; break
if a_id:
    call('GET', f'/results/grid/{a_id}', teacher, expect=200, label='result grid')

print('\n-- parent --')
par = call('GET', '/dashboard/parent', parent, expect=200, label='parent dashboard')
learners = par['data'].get('learners', [])
print('      linked learners:', [l['fullName'] for l in learners])
if learners:
    lid = learners[0]['id']
    call('GET', f'/results/learner/{lid}', parent, expect=200, label='child results')
    call('GET', f'/results/learner/{lid}/progress', parent, expect=200, label='child progress')
    call('GET', f'/timetables/learner/{lid}', parent, expect=200, label='child timetable')
call('GET', '/resources', parent, expect=200, label='parent resources')
call('GET', '/notifications', parent, expect=200, label='parent notifications')

print('\n-- security checks (must all fail cleanly) --')
call('GET', '/dashboard/admin', parent, expect=403, label='parent -> admin dashboard')
call('GET', '/dashboard/admin', teacher, expect=403, label='teacher -> admin dashboard')
call('GET', '/reports/school', teacher, expect=403, label='teacher -> school report')
call('GET', '/audit-logs', teacher, expect=403, label='teacher -> audit trail')
call('POST', '/timetables/publish', teacher, body={'versionId': 'x'}, expect=403, label='teacher -> publish timetable')
call('POST', '/results/grid/' + (a_id or 'x'), parent, body={'entries': []}, expect=403, label='parent -> enter results')
# IDOR: parent asks for a learner that is not theirs (first learner of the school)
all_learners = call('GET', '/learners?pageSize=3', admin, expect=200, label='admin learners')
al_items = all_learners['data'] if isinstance(all_learners['data'], list) else all_learners['data']['items']
if learners and al_items:
    other = [l for l in al_items if l['id'] != learners[0]['id']]
    if other:
        # The parent-link guard answers 403 ("not linked to your account") rather than
        # hiding the record behind a 404: both are denials, and this one tells a
        # signed-in guardian why they cannot see it.
        call('GET', f"/results/learner/{other[0]['id']}", parent, expect=403, label='parent -> unrelated learner results')
        call('GET', f"/timetables/learner/{other[0]['id']}", parent, expect=403, label='parent -> unrelated learner timetable')
    call('GET', f"/learners/{other[0]['id']}", parent, expect=403, label='parent -> learner record')
