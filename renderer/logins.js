'use strict';
(() => {
  const $ = (id) => document.getElementById(id);
  const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };

  async function showLogins() {
    const list = await window.api.logins.list();
    const box = $('lgList');
    box.textContent = '';
    $('lgMsg').textContent = '';
    list.forEach((s) => {
      const card = el('div', 'lgcard');
      card.appendChild(el('b', 'lgtitle', s.title));
      const u = el('input'); u.placeholder = 'Identifiant ou e-mail'; u.value = s.user; u.autocomplete = 'off';
      const p = el('input'); p.type = 'password'; p.autocomplete = 'new-password';
      p.placeholder = s.hasPass ? '•••••••• (enregistré — laissez vide pour le garder)' : 'Mot de passe';
      const show = el('button', 'btn', 'Afficher'); show.type = 'button';
      show.addEventListener('click', () => { p.type = p.type === 'password' ? 'text' : 'password'; show.textContent = p.type === 'password' ? 'Afficher' : 'Masquer'; });
      const pr = el('div', 'row'); pr.append(p, show);
      const auto = el('label', 'lgauto'); const cb = el('input'); cb.type = 'checkbox'; cb.checked = s.auto;
      auto.append(cb, document.createTextNode(' Se connecter automatiquement (appuie sur « Connexion » pour vous, une fois par minute au plus)'));
      const save = el('button', 'btn primary', 'Enregistrer');
      const del = el('button', 'btn danger', 'Supprimer');
      save.addEventListener('click', async () => {
        const r = await window.api.logins.save({ key: s.key, user: u.value, pass: p.value, keepPass: s.hasPass, auto: cb.checked });
        $('lgMsg').textContent = `${s.title} : ${r.message}`;
        showLogins().then(() => { $('lgMsg').textContent = `${s.title} : ${r.message}`; });
      });
      del.addEventListener('click', async () => {
        if (!window.confirm(`Supprimer l’identifiant enregistré pour ${s.title} ?`)) return;
        await window.api.logins.remove(s.key);
        showLogins().then(() => { $('lgMsg').textContent = `${s.title} : identifiant supprimé.`; });
      });
      const actions = el('div', 'row'); actions.append(save, del);
      card.append(u, pr, auto, actions);
      box.appendChild(card);
    });
    $('lgNote').textContent = list.length && list[0].encrypted
      ? 'Les mots de passe sont chiffrés sur ce PC avec la protection de votre session Windows.'
      : '⚠ Le chiffrement de Windows n’est pas disponible : les mots de passe seraient enregistrés sans protection.';
  }
  window.showLogins = showLogins;
})();
