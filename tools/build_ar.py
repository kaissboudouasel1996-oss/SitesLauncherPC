# -*- coding: utf-8 -*-
"""Builds src/data/ar.json and renderer/ar-data.js: the phone's Arabic table (Tr.kt) joined to the PC texts of ar_extra.py."""
import re, json, os, sys
sys.path.insert(0, os.path.dirname(__file__))
import ar_extra
TR = '/home/claude/SitesLauncher/app/src/main/java/ma/sites/launcher/Tr.kt'
src = open(TR, encoding='utf8').read()
def table(name):
    i = src.index('val %s: Map<String, String> = mapOf(' % name); j = src.index('\n    )', i); out = {}
    for m in re.finditer(r'"((?:[^"\\]|\\.)*)"\s+to\s+"((?:[^"\\]|\\.)*)"', src[i:j]):
        un = lambda x: x.replace('\\"', '"').replace('\\\\', '\\').replace('\\n', '\n').replace('\\$', '$')
        out[un(m.group(1))] = un(m.group(2))
    return out
fr, ar = table('fr'), table('ar')
nk = lambda s: re.sub(r'\s+', ' ', s.replace('’', "'")).strip()

dict_ = {}; rules = []
for k, v in fr.items():
    if k not in ar or not v.strip() or len(v) > 220: continue
    a = ar[k]
    if re.search(r'%(?:\d\$)?[ds]', v):
        # a format string: « %d/%d placés · %d sans place » becomes a pattern
        parts = re.split(r'(%(?:\d\$)?[ds])', v); pat = ''; idx = 0; order = {}
        for p in parts:
            m = re.fullmatch(r'%(?:(\d)\$)?([ds])', p)
            if m:
                idx += 1; order[m.group(1) or str(idx)] = idx
                pat += r'(\d+)' if m.group(2) == 'd' else r'(.+?)'
            else: pat += re.escape(re.sub(r'\s+', ' ', p.replace('’', "'"))).replace(r'\ ', ' ')
        tpl = a; seq = 0
        def sub(mm):
            global seq
            seq += 1
            return '$' + str(order.get(mm.group(1) or str(seq), seq))
        tpl = re.sub(r'%(?:(\d)\$)?[ds]', sub, tpl)
        rules.append(['^' + pat.replace("'", "['’]") + '$', 'i', tpl])
    else:
        dict_.setdefault(nk(v), a)
for k, v in ar_extra.EXACT.items(): dict_[nk(k)] = v
rules = [[pat, '', tpl] for pat, tpl in ar_extra.RULES] + rules   # the PC rules come first: they correct or complete the phone's

# day and month names are translated inside any text (« mercredi 4 novembre 2026 »)
data = {
  'dict': dict_, 'rules': rules,
  'days': {'dimanche': 'الأحد', 'lundi': 'الإثنين', 'mardi': 'الثلاثاء', 'mercredi': 'الأربعاء', 'jeudi': 'الخميس', 'vendredi': 'الجمعة', 'samedi': 'السبت'},
  'months': ['يناير', 'فبراير', 'مارس', 'أبريل', 'ماي', 'يونيو', 'يوليوز', 'غشت', 'شتنبر', 'أكتوبر', 'نونبر', 'دجنبر'],
  'monthsFr': ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre']
}
root = os.path.join(os.path.dirname(__file__), '..')
os.makedirs(os.path.join(root, 'src', 'data'), exist_ok=True)
js = json.dumps(data, ensure_ascii=False, separators=(',', ':'))
open(os.path.join(root, 'src', 'data', 'ar.json'), 'w', encoding='utf8').write(js)
open(os.path.join(root, 'renderer', 'ar-data.js'), 'w', encoding='utf8').write('window.AR_DATA=' + js + ';\n')
print('dict', len(dict_), 'rules', len(rules), 'bytes', len(js))
