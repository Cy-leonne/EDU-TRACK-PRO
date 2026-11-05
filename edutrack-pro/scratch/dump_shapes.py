"""Record the exact JSON shape of each API response the web app will consume."""
import json, urllib.request, urllib.error, os
BASE='http://localhost:4000/api/v1'
CACHE=os.path.join(os.path.dirname(__file__),'.tokens.json')

def login(email, pw):
    req=urllib.request.Request(BASE+'/auth/login', method='POST', data=json.dumps({'email':email,'password':pw,'clientType':'WEB'}).encode())
    req.add_header('Content-Type','application/json')
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.load(r)['data']

def get(path, token):
    req=urllib.request.Request(BASE+path)
    req.add_header('Authorization', f'Bearer {token}')
    try:
        with urllib.request.urlopen(req, timeout=60) as r: return json.load(r).get('data')
    except urllib.error.HTTPError as e:
        return {'__error': e.code, '__body': e.read().decode()[:180]}

def shape(v, depth=0):
    if isinstance(v, list):
        return [shape(v[0], depth+1)] if v else []
    if isinstance(v, dict):
        if depth > 3: return '…'
        return {k: shape(x, depth+1) for k,x in v.items()}
    if isinstance(v, str) and len(v) > 40: return v[:40]+'…'
    return v

tokens={}
for role in ('admin','teacher','parent'):
    d=login(f'{role}@nhjs.demo', {'admin':'Admin','teacher':'Teacher','parent':'Parent'}[role]+'-EduTrack-2026!demo')
    tokens[role]=d['accessToken']
    json.dump({k:{'token':v,'user':None} for k,v in tokens.items()}, open(CACHE,'w'))

out={}
# ---- shared / admin ----
A=tokens['admin']; T=tokens['teacher']; P=tokens['parent']
paths_admin=[
 '/auth/me','/school/bootstrap','/school/profile','/school/academic-years','/school/terms','/school/grades',
 '/dashboard/admin','/reports/school',
 '/classes','/learners?pageSize=2','/teachers?pageSize=2','/parents?pageSize=2','/parent-links?pageSize=2',
 '/learning-areas','/learning-areas/strands?learningAreaId=__','/learning-areas/requirements',
 '/teacher-assignments','/teacher-assignments/coverage',
 '/assessments?pageSize=2','/assessments/categories','/assessments/achievement-levels','/assessments/rubrics','/assessments/dashboard',
 '/resources?pageSize=2','/resources/assignments?pageSize=2',
 '/timetables','/timetables/periods','/timetables/rooms','/timetables/preflight',
 '/notifications','/notifications/preferences','/notifications/unread-count','/audit-logs?pageSize=2',
]
for p in paths_admin:
    out['admin '+p]=shape(get(p, A))

# ids for nested lookups
classes=get('/classes?pageSize=1',A); out['admin /classes[0] ids']=shape(get('/classes',A)[0]) if isinstance(get('/classes',A),list) else None
cid = (classes[0]['id'] if isinstance(classes,list) and classes else None)
if cid:
    out['admin /classes/:id']=shape(get(f'/classes/{cid}',A))
    out['admin /classes/:id/learners']=shape(get(f'/classes/{cid}/learners',A))
learners=get('/learners?pageSize=1',A)
litems = learners if isinstance(learners,list) else learners.get('items',[])
lid = litems[0]['id'] if litems else None
if lid:
    out['admin /learners/:id']=shape(get(f'/learners/{lid}',A))
assess=get('/assessments?pageSize=1',A)
aitems = assess if isinstance(assess,list) else assess.get('items',[])
aid = aitems[0]['id'] if aitems else None
if aid:
    out['admin /assessments/:id']=shape(get(f'/assessments/{aid}',A))
    out['admin /results/grid/:id']=shape(get(f'/results/grid/{aid}',A))
la=get('/learning-areas',A)
out['admin /learning-areas']=shape(la)
if isinstance(la,list) and la:
    out['admin /learning-areas/strands']=shape(get(f"/learning-areas/strands?learningAreaId={la[0]['id']}",A))
ver=get('/timetables',A)
out['admin /timetables']=shape(ver)
vid=None
if isinstance(ver,list) and ver:
    v=ver[0]; vid=v.get('currentVersionId') or v.get('versions',[{}])[0].get('id') if isinstance(v.get('versions'),list) else v.get('id')
    out['admin /timetables[0]']=shape(v)
    if v.get('versions'): out['admin versions[0]']=shape(v['versions'][0])
    vid = (v.get('versions') or [{}])[0].get('id') or v.get('currentVersionId')
if vid:
    out['admin /timetables/versions/:id']=shape(get(f'/timetables/versions/{vid}',A))
    out['admin /timetables/versions/:id/school-grid']=shape(get(f'/timetables/versions/{vid}/school-grid',A))
    out['admin /timetables/:vid/conflicts']=shape(get(f'/timetables/{vid}/conflicts',A))
# ---- teacher / parent ----
for p in ['/dashboard/teacher','/timetables/me','/teacher-assignments/me','/submissions?pageSize=2','/auth/me']:
    out['teacher '+p]=shape(get(p,T))
for p in ['/dashboard/parent','/submissions?pageSize=2','/notifications/preferences']:
    out['parent '+p]=shape(get(p,P))
if lid:
    out['parent /results/learner/:id']=shape(get(f'/results/learner/{lid}',P))
    out['parent /results/learner/:id/progress']=shape(get(f'/results/learner/{lid}/progress',P))
    out['parent /timetables/learner/:id']=shape(get(f'/timetables/learner/{lid}',P))

json.dump(out, open(os.path.join(os.path.dirname(__file__),'api-shapes.json'),'w'), indent=1)
for k,v in out.items():
    print('='*4, k)
    print(json.dumps(v, indent=1)[:1100])
