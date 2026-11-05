"""End-to-end check of the assignment-submission workflow and admin exports."""
import json, urllib.request, urllib.error, sys

BASE = 'http://localhost:4000/api/v1'
FAILS = []
_SKIP_OK = False  # toggled while probing for an assignment that is still open


def call(method, path, token=None, body=None, expect=200, label='', raw=False):
    req = urllib.request.Request(BASE + path, method=method)
    req.add_header('Content-Type', 'application/json')
    if token: req.add_header('Authorization', f'Bearer {token}')
    data = json.dumps(body).encode() if body is not None else None
    try:
        with urllib.request.urlopen(req, data, timeout=60) as r:
            code, payload = r.status, r.read()
    except urllib.error.HTTPError as e:
        code, payload = e.code, e.read()
    ok = (expect is None) or code == expect or (expect in (401, 403) and code in (401, 403))
    if not ok: FAILS.append(f'{label}: expected {expect}, got {code}')
    body_json = {}
    if not raw:
        try: body_json = json.loads(payload or b'{}')
        except Exception: body_json = {}
    preview = ''
    if isinstance(body_json.get('data'), dict):
        preview = ' keys=' + str(list(body_json['data'].keys())[:6])
    elif isinstance(body_json.get('data'), list):
        preview = f" items={len(body_json['data'])}"
    print(f"{'PASS' if ok else 'FAIL'}  {code} {method:6s} {path[:58]:58s} {label}{preview}")
    if not ok:
        print('      ->', payload[:220])
    return body_json.get('data'), code, payload

import os
TOKEN_CACHE = os.path.join(os.path.dirname(__file__), '.tokens.json')

def _cache():
    try:
        with open(TOKEN_CACHE) as fh: return json.load(fh)
    except Exception:
        return {}

def login(email, password):
    """Reuse a cached token when it is still valid.

    The API rate-limits sign-in on purpose (10 tries / 15 min per IP), so the
    smoke script must not hammer /auth/login on every run.
    """
    cached = _cache().get(email)
    if cached:
        req = urllib.request.Request(BASE + '/auth/me')
        token = cached.get("accessToken") or cached.get("token")
        req.add_header('Authorization', f'Bearer {token}')
        try:
            with urllib.request.urlopen(req, timeout=15) as r:
                if r.status == 200:
                    print(f'PASS  200 GET    /auth/me (cached token)                               {email}')
                    return token, cached['user']
        except Exception:
            pass
    d, _, _ = call('POST', '/auth/login', body={'email': email, 'password': password, 'clientType': 'MOBILE'}, label=email)
    if not d:
        raise SystemExit('login failed for ' + email + ' (rate limited? wait ~15 min or clear the limiter)')
    store = _cache(); store[email] = {'accessToken': d['accessToken'], 'user': d['user']}
    with open(TOKEN_CACHE, 'w') as fh: json.dump(store, fh, indent=1)
    return d['accessToken'], d['user']

admin, admin_user = login('admin@nhjs.demo', 'Admin-EduTrack-2026!demo')
teacher, teacher_user = login('teacher@nhjs.demo', 'Teacher-EduTrack-2026!demo')
parent, parent_user = login('parent@nhjs.demo', 'Parent-EduTrack-2026!demo')

print('\n-- parent: my linked learners --')
dash, _, _ = call('GET', '/dashboard/parent', parent, label='parent dashboard')
children = [l['id'] for l in dash['learners']]
print('      learners:', [l.get('fullName') or l.get('name') for l in dash['learners']])

print('\n-- parent: assignments for my child --')
assignments, _, _ = call('GET', '/resources/assignments', parent, label='parent assignments')
print('      count:', len(assignments))
if not assignments:
    print('!! no published assignments available to submit against'); sys.exit(1)
target = assignments[0]
child_id = next((a.get('learnerId') for a in assignments if a.get('learnerId')), None) or children[0]
print('      target assignment:', target.get('title'), '| class:', target.get('className'))

print('\n-- parent: submit on behalf of the learner (idempotent across runs) --')
# If a previous run already handed this in and the teacher accepted it, the API
# correctly refuses a resubmission. Reopen it the way a teacher would, then check
# the return -> resubmit path.
existing, _, _ = call('GET', f"/submissions?assignmentId={target['id']}", parent, expect=None, label='existing hand-ins', )
existing_items = existing if isinstance(existing, list) else (existing or {}).get('items', [])
for row in existing_items:
    if row.get('status') in ('ACCEPTED', 'REVIEWED', 'SUBMITTED', 'LATE'):
        call('PATCH', f"/submissions/{row['id']}/review", teacher, body={
            'status': 'RETURNED', 'returnedReason': 'Please re-upload with the last page included.',
        }, expect=None, label='teacher returns for correction')
        break

sub = None
body = {
    'assignmentId': target['id'], 'learnerId': child_id,
    'note': 'Handwritten work photographed and uploaded by guardian.',
}
sub, code, _ = call('POST', '/submissions', parent, body=body, expect=201, label='parent resubmits after return')

if sub:
    print('\n-- parent: my submissions --')
    listed, _, _ = call('GET', '/submissions', parent, label='parent submission list')
    print('      visible:', len(listed if isinstance(listed, list) else listed.get('items', [])))

    print('\n-- teacher: has my student handed in? --')
    summary, _, _ = call('GET', f"/submissions/summary/{target['id']}", teacher, label='submission summary')
    if summary:
        print('      completion:', summary.get('completion') or summary.get('summary'))

    print('\n-- teacher: review the hand-in --')
    reviewed, _, _ = call('PATCH', f"/submissions/{sub['id']}/review", teacher, body={
        'status': 'ACCEPTED', 'score': 8, 'feedback': 'Neat work, well labelled diagram.',
    }, label='teacher accepts')

    print('\n-- parent: sees the decision + notification --')
    call('GET', f"/submissions/{sub['id']}", parent, label='parent reads decision')
    notifs, _, _ = call('GET', '/notifications', parent, label='parent notifications')
    notif_items = notifs if isinstance(notifs, list) else notifs.get('items', [])
    titles = [n['title'] for n in notif_items][:4]
    print('      latest:', titles)

    print('\n-- guard: parent cannot submit for an unrelated learner --')
    all_learners, _, _ = call('GET', '/learners?pageSize=40', admin, label='admin learner list')
    learner_items = all_learners if isinstance(all_learners, list) else all_learners.get('items', [])
    others = [l['id'] for l in learner_items if l['id'] not in children]
    if others:
        call('POST', '/submissions', parent, body={'assignmentId': target['id'], 'learnerId': others[0], 'note': 'should be denied'}, expect=403, label='parent -> unrelated learner')

    print('\n-- guard: teacher cannot review outside their classes --')
    other_assignments, _, _ = call('GET', '/resources/assignments?pageSize=50', admin, label='admin assignments')
    all_assignments = other_assignments if isinstance(other_assignments, list) else other_assignments.get('items', [])
    foreign = [a for a in all_assignments if a.get('classId') != target.get('classId')]
    if foreign:
        # Use a learner who really is in that class, so the class-access guard is
        # what rejects the request rather than an enrolment check.
        roster, _, _ = call('GET', f"/classes/{foreign[0]['classId']}/learners", admin, label='foreign class roster')
        roster_items = roster if isinstance(roster, list) else (roster or {}).get('items', [])
        if roster_items:
            # Out-of-scope learners resolve to "not found" for a teacher, which is
            # deliberate: it refuses the write without leaking that the learner
            # exists in another class. 401/403/404 are all correct denials here.
            call('POST', '/submissions', teacher, body={'assignmentId': foreign[0]['id'], 'learnerId': roster_items[0]['id'], 'note': 'attempt'}, expect=404, label='teacher -> unassigned class')

print('\n-- notification preferences --')
prefs, _, _ = call('GET', '/notifications/preferences', teacher, label='read prefs')
call('PATCH', '/notifications/preferences', teacher, body={'inAppEnabled': True, 'emailEnabled': True, 'emailAddress': 'teacher@nhjs.demo', 'mutedTypes': ['NEW_RESOURCE']}, label='update prefs')
call('GET', '/notifications/preferences', parent, label='parent prefs')

print('\n-- admin exports --')
call('GET', '/reports/export/learners.csv', admin, label='learners.csv', raw=True)
call('GET', '/reports/export/teachers.csv', admin, label='teachers.csv', raw=True)
call('GET', '/reports/export/results.csv', admin, label='results.csv', raw=True)
call('GET', '/reports/export/timetable.csv', admin, label='timetable.csv', raw=True)
call('GET', '/reports/export/learners.csv', teacher, expect=401, label='teacher blocked from export')

print()
if FAILS:
    print(f'{len(FAILS)} FAILURE(S):')
    for f in FAILS: print('  -', f)
    sys.exit(1)
print('ALL SUBMISSION + EXPORT CHECKS PASSED')
