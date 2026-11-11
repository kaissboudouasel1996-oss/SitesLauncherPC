"""Lists the French texts of the PC screens and tells which ones the phone's Arabic table already translates."""
import re, json, glob, html, sys
base='/home/claude/SitesLauncher/app/src/main/java/ma/sites/launcher/Tr.kt'
src=open(base,encoding='utf8').read()
def table(name):
    i=src.index('val %s: Map<String, String> = mapOf('%name)
    j=src.index('\n    )',i)
    body=src[i:j]
    out={}
    for m in re.finditer(r'"((?:[^"\\]|\\.)*)"\s+to\s+"((?:[^"\\]|\\.)*)"',body):
        k=m.group(1).replace('\\"','"').replace('\\\\','\\').replace('\\n','\n').replace('\\$','$')
        v=m.group(2).replace('\\"','"').replace('\\\\','\\').replace('\\n','\n').replace('\\$','$')
        out[k]=v
    return out
fr=table('fr'); ar=table('ar')
f2a={}
for k,v in fr.items():
    if k in ar and v.strip(): f2a.setdefault(v,ar[k])
json.dump(f2a,open('/tmp/f2a.json','w',encoding='utf8'),ensure_ascii=False,indent=0)
print('joined fr->ar entries:',len(f2a),'| fr',len(fr),'ar',len(ar),file=sys.stderr)

cands=set()
def add(s):
    s=s.strip()
    if len(s)>=2 and re.search(r'[A-Za-zÀ-ÿ]',s) and not re.match(r'^[a-z][A-Za-z0-9_.:\-/#\[\]=*>+ ]*$',s) : cands.add(s)
h=open('renderer/index.html',encoding='utf8').read()
h=re.sub(r'<script.*?</script>|<style.*?</style>','',h,flags=re.S)
for m in re.finditer(r'>([^<>]+)<',h): add(html.unescape(re.sub(r'\s+',' ',m.group(1))))
for m in re.finditer(r'(?:placeholder|title)="([^"]+)"',h): add(html.unescape(m.group(1)))
for f in [x for x in glob.glob('renderer/*.js') if x not in ('renderer/fiche.js',)]+['renderer/fiche.js']:
    t=open(f,encoding='utf8').read()
    for m in re.finditer(r"'((?:[^'\\\n]|\\.)*)'|`((?:[^`\\]|\\.)*)`",t):
        s=m.group(1) if m.group(1) is not None else m.group(2)
        s=s.replace("\\'","'")
        if re.search(r'[À-ÿ]|[A-Z][a-zé]+ [a-zé]+',s) and ' ' in s: add(s)
SKIP=('src/builder.js','src/docx.js','src/ppt.js','src/zip.js','src/xml.js','src/sommaire.js','src/data')
for f in ['main.js']+[x for x in glob.glob('src/*.js') if x not in SKIP]:
    t=open(f,encoding='utf8').read()
    for m in re.finditer(r"'((?:[^'\\\n]|\\.)*)'",t):
        s=m.group(1).replace("\\'","'")
        if re.search(r'[À-ÿ’]',s) and ' ' in s and not s.startswith('-') and '<' not in s: add(s)
missing=sorted(c for c in cands if c not in f2a)
covered=sorted(c for c in cands if c in f2a)
json.dump({'covered':covered,'missing':missing},open('/tmp/cands.json','w',encoding='utf8'),ensure_ascii=False,indent=0)
print('candidates',len(cands),'covered',len(covered),'missing',len(missing),file=sys.stderr)
