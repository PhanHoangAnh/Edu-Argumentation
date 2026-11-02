import sys
from html.parser import HTMLParser
VOID = {'area','base','br','col','embed','hr','img','input','link','meta','param','source','track','wbr','path','rect','circle','line','polygon','polyline','use','stop','ellipse'}
class C(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True); self.stack=[]; self.err=[]
    def handle_starttag(self, tag, attrs):
        if tag in VOID: return
        self.stack.append((tag, self.getpos()))
    def handle_startendtag(self, tag, attrs): pass
    def handle_endtag(self, tag):
        if tag in VOID: return
        if not self.stack:
            self.err.append(f'stray </{tag}> at {self.getpos()}'); return
        if self.stack[-1][0] == tag:
            self.stack.pop(); return
        for i in range(len(self.stack)-1, -1, -1):
            if self.stack[i][0] == tag:
                for t,pos in self.stack[i+1:]:
                    self.err.append(f'unclosed <{t}> opened at {pos}, closed by </{tag}>')
                del self.stack[i:]
                return
        self.err.append(f'mismatched </{tag}> at {self.getpos()}')
c = C()
c.feed(open(sys.argv[1], encoding='utf-8').read())
for t,pos in c.stack: c.err.append(f'never closed <{t}> opened at {pos}')
for e in c.err: print('ERROR:', e)
print(f'{len(c.err)} errors')
sys.exit(1 if c.err else 0)
