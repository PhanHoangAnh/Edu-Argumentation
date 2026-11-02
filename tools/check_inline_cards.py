#!/usr/bin/env python3
"""Invariant proof for the R6-cards transform: before vs after."""
import json,re,sys,collections,difflib

def load(p): return json.load(open(p,encoding='utf-8'))
def items(d):
    for si,sec in enumerate(d.get('tutorialData',{}).get('sections',[]) or []):
        for ii,it in enumerate(sec.get('items',[]) or []):
            yield 'ch%02d-b%02d'%(si+1,ii+1), it
def nows(s): return re.sub(r'\s+','',s)

def census(d):
    c=collections.Counter(); text_chars=0; cells=[]; descs=[]; deepers=[]
    for lid,it in items(d):
        for b in it.get('blocks',[]) or []:
            t=b.get('type'); c[t]+=1
            if t=='text': text_chars+=len(nows(b.get('content','') or ''))
            elif t=='code_cells':
                for cell in b.get('cells',[]) or []:
                    cells.append(json.dumps(cell,sort_keys=True,ensure_ascii=False))
                c['code_cells_cells']+=len(b.get('cells',[]) or [])
                c['code_cells_lesson_'+str(b.get('lesson'))]+=0
            elif t=='figure':
                if b.get('description'): descs.append(b['description']); c['figure_description']+=1
            elif t=='deeper': deepers.append(json.dumps(b,sort_keys=True,ensure_ascii=False))
    return c,text_chars,cells,descs,deepers

def sig(it):
    """structural signature of a lesson: ordered block types + card titles"""
    out=[]
    for b in it.get('blocks',[]) or []:
        t=b.get('type')
        if t=='card': out.append('card:'+str(b.get('title')))
        elif t=='text': out.append('text')
        elif t in ('figure','equation'): out.append(t+':'+str(b.get('asset') or b.get('src')))
        elif t=='code_cells': out.append('code_cells:%d'%len(b.get('cells') or []))
        else: out.append(t)
    return out

a,b=sys.argv[1],sys.argv[2]
A,B=load(a),load(b)
ca,ta,cella,da,dpa=census(A)
cb,tb,cellb,db,dpb=census(B)
fail=[]
print("== BLOCK COUNTS BY TYPE ==")
for t in sorted(set(ca)|set(cb)):
    if t.startswith('code_cells_lesson_'): continue
    if ca[t]!=cb[t]:
        flag='  <-- DELTA %+d'%(cb[t]-ca[t])
        if t!='text': fail.append('block count changed for %r: %d -> %d'%(t,ca[t],cb[t]))
    else: flag=''
    print("  %-22s %6d -> %6d%s"%(t,ca[t],cb[t],flag))
print("\n== HARD INVARIANTS ==")
def chk(name,ok,detail=''):
    print("  [%s] %s %s"%('PASS' if ok else 'FAIL',name,detail))
    if not ok: fail.append(name)
chk('card count unchanged', ca['card']==cb['card'], '%d -> %d'%(ca['card'],cb['card']))
chk('figure count unchanged', ca['figure']==cb['figure'], '%d -> %d'%(ca['figure'],cb['figure']))
chk('equation count unchanged', ca['equation']==cb['equation'], '%d -> %d'%(ca['equation'],cb['equation']))
chk('quizData count unchanged', len(A.get('quizData') or [])==len(B.get('quizData') or []),
    '%d -> %d'%(len(A.get('quizData') or []),len(B.get('quizData') or [])))
chk('code_cells cells byte-identical', cella==cellb, '%d cells'%len(cellb))
chk('figure.description fields intact', da==db, '%d descriptions'%len(db))
chk('deeper panels byte-identical', dpa==dpb, '%d deeper panels'%len(dpb))
chk('NO PROSE DELETED (non-ws char sum over text blocks)', ta==tb, '%d -> %d chars'%(ta,tb))
print("\n== PER-LESSON STRUCTURAL DIFF (LCS alignment) ==")
la={lid:sig(it) for lid,it in items(A)}
lb={lid:sig(it) for lid,it in items(B)}
chk('lesson set unchanged', set(la)==set(lb), '%d lessons'%len(lb))
changed=0; bad=0
for lid in la:
    if la[lid]==lb[lid]: continue
    changed+=1
    sm=difflib.SequenceMatcher(a=la[lid],b=lb[lid],autojunk=False)
    ins=dele=0
    for tag,i1,i2,j1,j2 in sm.get_opcodes():
        if tag in ('insert','replace'): ins+=j2-j1
        if tag in ('delete','replace'): dele+=i2-i1
    # every inserted/deleted element must be 'text' (a split) or a card (a move)
    delset=[x for tag,i1,i2,j1,j2 in sm.get_opcodes() if tag in ('delete','replace') for x in la[lid][i1:i2]]
    insset=[x for tag,i1,i2,j1,j2 in sm.get_opcodes() if tag in ('insert','replace') for x in lb[lid][j1:j2]]
    illegal=[x for x in delset+insset if not (x=='text' or x.startswith('card:'))]
    if illegal:
        bad+=1
        if bad<=6: print("  ILLEGAL move in %s: %s"%(lid,illegal[:6]))
    # multiset of non-text elements must be identical
    ma=collections.Counter(x for x in la[lid] if x!='text')
    mb=collections.Counter(x for x in lb[lid] if x!='text')
    if ma!=mb:
        bad+=1
        if bad<=6: print("  MULTISET CHANGED in %s: %s"%(lid,(mb-ma)+(ma-mb)))
chk('only text-splits and card-moves occurred', bad==0, '%d lessons changed, %d illegal'%(changed,bad))
print("\nRESULT: %s"%('ALL INVARIANTS PASS' if not fail else 'FAILURES: '+'; '.join(fail)))
sys.exit(1 if fail else 0)
