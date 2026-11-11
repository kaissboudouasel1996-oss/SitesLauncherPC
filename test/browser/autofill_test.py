"""Checks the login script in a real browser (Chromium). Run: node test/browser/dump.js > /tmp/autofill.js ; python3 test/browser/autofill_test.py"""
import subprocess, json, sys, os
from playwright.sync_api import sync_playwright
root = os.path.dirname(os.path.abspath(__file__))
def script(u, p, a):
    return subprocess.run(['node', '-e', "const s=require('%s/../../src/sites');console.log(s.autofillScript(JSON.parse(process.argv[1]),JSON.parse(process.argv[2]),%s))" % (root, 'true' if a else 'false'), json.dumps(u), json.dumps(p)], capture_output=True, text=True, check=True).stdout
with sync_playwright() as pw:
    b = pw.chromium.launch(); pg = b.new_page(); logs = []
    pg.on('console', lambda m: logs.append(m.text))
    url = 'file://' + root + '/login_pages.html'
    # 1) fills the right fields (not the search box), does not press the button
    pg.goto(url); pg.evaluate(script('ali@mail.ma', 'p"a\\ss</script>', False)); pg.wait_for_timeout(700)
    assert pg.input_value('#u') == 'ali@mail.ma', pg.input_value('#u')
    assert pg.input_value('#p') == 'p"a\\ss</script>', pg.input_value('#p')
    assert pg.input_value('#decoy') == '', 'the search box must stay empty'
    assert pg.title() == 'login' and '__madrassa_autoclicked__' not in logs, 'manual fill never presses the button'
    # 2) with the permission, presses « Se connecter » once (not « Mot de passe oublié »)
    logs.clear(); pg.goto(url); pg.evaluate(script('ali', 'secret', True)); pg.wait_for_timeout(1500)
    assert pg.title() == 'SUBMITTED:ali|secret', pg.title()
    assert logs.count('__madrassa_autoclicked__') == 1, logs
    # 3) a field already typed by the person is not overwritten
    pg.goto(url); pg.fill('#u', 'moi'); pg.evaluate(script('ali', 'secret', False)); pg.wait_for_timeout(700)
    assert pg.input_value('#u') == 'moi' and pg.input_value('#p') == 'secret'
    # 4) a page without a login form: nothing happens, no error
    pg.goto('data:text/html,<p>hello</p>'); pg.evaluate(script('a', 'b', True)); pg.wait_for_timeout(300)
    # 5) typing a code in the focused field
    pg.goto(url); pg.focus('#decoy')
    code_js = subprocess.run(['node', '-e', "console.log(require('%s/../../src/sites').fillCodeScript('123456'))" % root], capture_output=True, text=True).stdout
    assert pg.evaluate(code_js) == 'ok' and pg.input_value('#decoy') == '123456'
    pg.evaluate('document.activeElement.blur()'); assert pg.evaluate(code_js) == 'no'
    b.close()
print('AUTOFILL BROWSER TEST PASSED')
