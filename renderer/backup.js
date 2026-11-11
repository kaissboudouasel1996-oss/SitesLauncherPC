'use strict';
(() => {
  const $ = (id) => document.getElementById(id);
  const msg = (t) => { $('bkMsg').textContent = t; };

  $('bkCreate').addEventListener('click', async () => {
    const a = $('bkPw').value;
    if (a.length < 6) { msg('Le mot de passe doit contenir au moins 6 caractères.'); return; }
    if (a !== $('bkPw2').value) { msg('Les mots de passe ne correspondent pas.'); return; }
    msg('Création de la sauvegarde…');
    const r = await window.api.backup.create(a);
    if (!r.ok) { msg(r.error); return; }
    if (r.canceled) { msg(''); return; }
    $('bkPw').value = ''; $('bkPw2').value = '';
    msg('Sauvegarde enregistrée : ' + r.path);
  });

  $('bkPick').addEventListener('click', async () => {
    const r = await window.api.backup.pick();
    if (r.canceled) return;
    $('bkFile').textContent = r.name;
    $('bkRestoreBox').hidden = false; $('bkRestore').hidden = false;
    $('bkPwR').value = ''; $('bkPwR').focus();
    msg('');
  });

  $('bkRestore').addEventListener('click', async () => {
    if (!$('bkPwR').value) { msg('Entrez le mot de passe de la sauvegarde.'); return; }
    msg('Restauration…');
    const r = await window.api.backup.restore($('bkPwR').value);
    if (!r.ok) { msg(r.error); return; }
    $('bkPwR').value = '';
    $('bkRestoreBox').hidden = true; $('bkRestore').hidden = true; $('bkFile').textContent = '';
    const s = r.summary;
    const parts = [];
    if (s.classes) parts.push(window.T(`${s.classes} classe(s)`));
    if (s.notes) parts.push(window.T(`${s.notes} note(s)`));
    if (s.files) parts.push(window.T(`${s.files} fichier(s)`));
    if (s.logins) parts.push(window.T(`${s.logins} identifiant(s) gardés pour plus tard`));
    if (s.accounts) parts.push(window.T(`${s.accounts} compte(s) Authenticator gardés pour plus tard`));
    const sep = window.I18N.lang === 'ar' ? '، ' : ', ';
    msg(window.T('Sauvegarde restaurée') + (parts.length ? ' : ' + parts.join(sep) + '.' : window.T('. Tout était déjà ici.')));
  });
})();
