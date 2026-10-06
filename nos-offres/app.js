// Lit data/offres_finales/ et data/offres_ecartees/ (une paire de fichiers par date listée
// dans dates.json) et recalcule toute la page selon les filtres.
const DATA = '../data/';
const css = n => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
const COUL = { 'Welcome to the Jungle': () => css('--bleu'), 'Adzuna': () => css('--orange') };
const CANAUX = ['Welcome to the Jungle', 'Adzuna'];
const nf = n => n.toLocaleString('fr-FR');
const pct = (a, b) => b ? Math.round(100 * a / b) : 0;
const eur = n => n == null ? '–' : Math.round(n).toLocaleString('fr-FR') + ' €';
const dateFr = d => d.split('-').reverse().slice(0, 2).join('/');
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// CSV avec guillemets (séparateur virgule, comme nos fichiers).
function lireCSV(texte) {
  const lignes = []; let ligne = [], champ = '', guil = false;
  for (let i = 0; i < texte.length; i++) {
    const c = texte[i];
    if (guil) {
      if (c === '"') { if (texte[i + 1] === '"') { champ += '"'; i++; } else guil = false; }
      else champ += c;
    } else if (c === '"') guil = true;
    else if (c === ',') { ligne.push(champ); champ = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && texte[i + 1] === '\n') i++;
      ligne.push(champ); champ = '';
      if (ligne.length > 1 || ligne[0] !== '') lignes.push(ligne);
      ligne = [];
    } else champ += c;
  }
  if (champ !== '' || ligne.length) { ligne.push(champ); lignes.push(ligne); }
  const tete = lignes.shift();
  return lignes.map(l => Object.fromEntries(tete.map((t, j) => [t, l[j] ?? ''])));
}
async function charger(chemin) {
  const r = await fetch(chemin);
  if (!r.ok) throw new Error(`${chemin} introuvable (${r.status})`);
  return lireCSV((await r.text()).replace(/^﻿/, ''));
}

let RET = [], ECA = [], DATES = [];
const graphes = {};
function dessiner(id, cfg) {
  if (graphes[id]) graphes[id].destroy();
  cfg.options = Object.assign({ responsive: true, maintainAspectRatio: false, animation: false,
    plugins: { legend: { position: 'bottom', labels: { color: css('--encre') } } } }, cfg.options || {});
  for (const ax of Object.values(cfg.options.scales || {})) {
    ax.ticks = Object.assign({ color: css('--doux') }, ax.ticks || {});
    ax.grid = Object.assign({ color: css('--trait') }, ax.grid || {});
  }
  graphes[id] = new Chart(document.getElementById(id), cfg);
}
const milieu = o => { const a = parseFloat(o.salaire_min), b = parseFloat(o.salaire_max); return isNaN(a) ? null : isNaN(b) ? a : (a + b) / 2; };
function ville(lieu) {
  let v = (lieu || '').split(',')[0].replace(/\d+/g, '').replace(/\s+(e|er|ème)?\s*arrondissement.*$/i, '').trim();
  if (/^paris\b/i.test(v)) v = 'Paris';
  return v ? v.toLowerCase().replace(/(^|[\s-])\S/g, s => s.toUpperCase()) : '(non indiqué)';
}
const inconnu = o => /non précisé/i.test(o.contrat);

function filtres() {
  return { date: f('f-date'), canal: f('f-canal'), contrat: f('f-contrat'), texte: f('f-texte').toLowerCase() };
  function f(id) { return document.getElementById(id).value; }
}
const garde = (F, o, avecContrat = true) => (!F.date || o.date_collecte === F.date) && (!F.canal || o.canal === F.canal) && (!avecContrat || !F.contrat || o.contrat === F.contrat);

function rendre() {
  const F = filtres();
  const R = RET.filter(o => garde(F, o)), E = ECA.filter(o => garde(F, o, false));
  const Rsc = RET.filter(o => garde(F, o, false));             // retenues sans le filtre contrat
  const relevees = Rsc.length + E.length;
  const quand = F.date ? `le ${dateFr(F.date)}` : `sur ${DATES.length} relevés`;

  // En chiffres
  const sal = R.filter(o => milieu(o) != null);
  const etu = R.filter(o => /stage|alternance/i.test(o.contrat));
  const nonPrecise = E.filter(inconnu).length;
  document.getElementById('tuiles').innerHTML = [
    [nf(relevees), `offres relevées ${quand}`],
    [nf(Rsc.length), `retenues pour l'analyse (${pct(Rsc.length, relevees)} %)`],
    [nf(E.length), 'écartées, avec leur raison'],
    [pct(relevees - nonPrecise, relevees) + ' %', 'des offres relevées indiquent le contrat'],
    [nf(etu.length), 'stages et alternances retenus'],
    [pct(sal.length, R.length) + ' %', `des offres retenues affichent un salaire (${sal.length})`],
  ].map(([v, t]) => `<div class="chiffre"><b>${v}</b><span>${t}</span></div>`).join('');

  // Nettoyage
  const raisons = {};
  // Les raisons détaillées (« … (achats) », « doublon : texte identique à … ») sont regroupées.
  const raisonCourte = r => r.replace(/ \([^)]*\)/g, '').replace(/^doublon.*/, 'doublon').trim();
  E.forEach(o => { const k = raisonCourte(o.raison_ecart); raisons[k] = (raisons[k] || 0) + 1; });
  document.getElementById('t-nettoyage').innerHTML =
    `<tr><th>Étape</th><th class="n">Offres</th></tr><tr><td>Offres relevées ${quand}</td><td class="n">${nf(relevees)}</td></tr>` +
    Object.entries(raisons).sort((a, b) => b[1] - a[1]).map(([r, n]) => `<tr><td>− ${esc(r)}</td><td class="n">− ${n}</td></tr>`).join('') +
    `<tr class="total"><td>Offres retenues</td><td class="n">${nf(Rsc.length)}</td></tr>`;
  const cs = CANAUX.filter(c => !F.canal || c === F.canal);
  dessiner('g-retenues', { type: 'bar', data: { labels: cs, datasets: [
    { label: 'Retenues', data: cs.map(c => Rsc.filter(o => o.canal === c).length), backgroundColor: css('--vert') },
    { label: 'Écartées', data: cs.map(c => E.filter(o => o.canal === c).length), backgroundColor: css('--gris') } ] },
    options: { scales: { x: { stacked: true }, y: { stacked: true, beginAtZero: true, title: { display: true, text: "Nombre d'offres" } } } } });
  const ad = c => [Rsc.filter(o => o.canal === c).length, E.filter(o => o.canal === c).length];
  const [wr, we] = ad('Welcome to the Jungle'), [ar, ae] = ad('Adzuna');
  document.getElementById('l-retenues').innerHTML = (!F.canal ? `On garde <b>${pct(wr, wr + we)} %</b> des offres de Welcome to the Jungle (${wr} sur ${wr + we}), mais seulement <b>${pct(ar, ar + ae)} %</b> de celles d'Adzuna (${ar} sur ${ar + ae}) : l'agrégateur ramène beaucoup d'offres hors marketing ou sans contrat.` : `${nf(Rsc.length)} offres retenues sur ${nf(relevees)} relevées.`);

  // Contrats
  const contrats = [...new Set(R.map(o => o.contrat))].sort((a, b) => R.filter(o => o.contrat === b).length - R.filter(o => o.contrat === a).length);
  dessiner('g-contrats', { type: 'bar', data: { labels: contrats, datasets: cs.map(c => ({ label: c, backgroundColor: COUL[c](), data: contrats.map(k => R.filter(o => o.contrat === k && o.canal === c).length) })) },
    options: { indexAxis: 'y', scales: { x: { stacked: true, beginAtZero: true, title: { display: true, text: `Nombre d'offres (total : ${R.length})` } }, y: { stacked: true } } } });
  const top = contrats[0];
  document.getElementById('l-contrats').innerHTML = top ? `Contrat le plus fréquent : <b>${esc(top)}</b>, ${R.filter(o => o.contrat === top).length} offres sur ${R.length} (${pct(R.filter(o => o.contrat === top).length, R.length)} %). Rappel : chaque liste Welcome to the Jungle ne montre qu'un type de contrat.` : 'Aucune offre avec ces filtres.';
  const connus = c => { const n = Rsc.filter(o => o.canal === c).length + E.filter(o => o.canal === c && !inconnu(o)).length; return [n, E.filter(o => o.canal === c && inconnu(o)).length]; };
  dessiner('g-connu', { type: 'bar', data: { labels: cs, datasets: [
    { label: 'Contrat indiqué', data: cs.map(c => { const [a, b] = connus(c); return pct(a, a + b); }), backgroundColor: css('--bleu') },
    { label: 'Non précisé', data: cs.map(c => { const [a, b] = connus(c); return pct(b, a + b); }), backgroundColor: css('--gris') } ] },
    options: { scales: { x: { stacked: true }, y: { stacked: true, beginAtZero: true, max: 100, title: { display: true, text: '% des offres relevées' } } } } });
  const [ak, au] = connus('Adzuna');
  document.getElementById('l-connu').innerHTML = (!F.canal || F.canal === 'Adzuna') && ak + au ? `Chez Adzuna, <b>${pct(au, ak + au)} %</b> des annonces ne précisent pas le contrat, même en lisant le texte complet (${au} sur ${ak + au}). Chez Welcome to the Jungle, il est toujours indiqué.` : 'Chez Welcome to the Jungle, le contrat est toujours indiqué sur l\'offre.';

  // Salaires
  const grp = [['Stage', o => o.contrat === 'Stage', '€ / mois'], ['Alternance', o => o.contrat === 'Alternance', '€ / an'], ['CDI et autres', o => !/stage|alternance/i.test(o.contrat), '€ / an']];
  const stat = v => { const s = v.slice().sort((a, b) => a - b), n = s.length; if (!n) return null; const med = n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2; return { n, med, min: s[0], max: s[n - 1], moy: s.reduce((a, b) => a + b, 0) / n }; };
  document.getElementById('t-salaires').innerHTML = `<tr><th>Contrat</th><th>Unité</th><th class="n">Offres</th><th class="n">Avec salaire</th><th class="n">Médiane</th><th class="n">Min</th><th class="n">Max</th></tr>` +
    grp.map(([nom, test, u]) => { const l = R.filter(test), s = stat(l.map(milieu).filter(x => x != null));
      return `<tr><td>${nom}</td><td>${u}</td><td class="n">${l.length}</td><td class="n">${s ? s.n : 0}</td><td class="n">${s ? eur(s.med) : '–'}</td><td class="n">${s ? eur(s.min) : '–'}</td><td class="n">${s ? eur(s.max) : '–'}</td></tr>`; }).join('');
  const parts = cs.map(c => { const l = R.filter(o => o.canal === c); return [l.filter(o => milieu(o) != null).length, l.length]; });
  dessiner('g-salaire-affiche', { type: 'bar', data: { labels: cs.map((c, i) => `${c} (n=${parts[i][1]})`), datasets: [{ label: 'Salaire affiché', data: parts.map(([a, b]) => pct(a, b)), backgroundColor: cs.map(c => COUL[c]()) }] },
    options: { plugins: { legend: { display: false } }, scales: { y: { beginAtZero: true, max: 100, title: { display: true, text: '% des offres retenues' } } } } });
  document.getElementById('l-salaire').innerHTML = `<b>${pct(sal.length, R.length)} %</b> des offres retenues affichent un salaire (${sal.length} sur ${R.length}) : les chiffres du tableau reposent sur de petits effectifs.`;

  // Villes et entreprises
  const cv = {}; R.forEach(o => { const v = ville(o.lieu); cv[v] = (cv[v] || 0) + 1; });
  const tv = Object.entries(cv).sort((a, b) => b[1] - a[1]).slice(0, 10);
  dessiner('g-villes', { type: 'bar', data: { labels: tv.map(t => t[0]), datasets: [{ data: tv.map(t => t[1]), backgroundColor: tv.map(t => /clermont|aubière|chamalières|gerzat|cournon/i.test(t[0]) ? css('--orange') : css('--bleu')) }] },
    options: { indexAxis: 'y', plugins: { legend: { display: false } }, scales: { x: { beginAtZero: true, ticks: { precision: 0 } }, y: { ticks: { autoSkip: false } } } } });
  const paris = cv['Paris'] || 0;
  document.getElementById('l-villes').innerHTML = R.length ? `<b>${pct(paris, R.length)} %</b> des offres retenues sont à Paris même (${paris} sur ${R.length}), sans compter la petite couronne. En orange : l'agglomération clermontoise.` : '';
  const ce = {}; R.forEach(o => { const e = (o.entreprise || '(non indiquée)').trim(); ce[e] = (ce[e] || 0) + 1; });
  const te = Object.entries(ce).filter(t => t[1] >= 2).sort((a, b) => b[1] - a[1]).slice(0, 12);
  dessiner('g-entreprises', { type: 'bar', data: { labels: te.map(t => t[0].length > 32 ? t[0].slice(0, 30) + '…' : t[0]), datasets: [{ data: te.map(t => t[1]), backgroundColor: css('--bleu') }] },
    options: { indexAxis: 'y', plugins: { legend: { display: false } }, scales: { x: { beginAtZero: true, ticks: { precision: 0 } }, y: { ticks: { autoSkip: false } } } } });

  // Évolution (toutes les dates, filtre canal seulement)
  const Rc = RET.filter(o => !F.canal || o.canal === F.canal);
  const ks = [...new Set(Rc.map(o => o.contrat))];
  const pal = [css('--bleu'), css('--orange'), css('--vert'), css('--gris'), css('--rouge'), '#8e5bd6'];
  dessiner('g-evolution', { type: 'bar', data: { labels: DATES.map(dateFr), datasets: ks.map((k, i) => ({ label: k, backgroundColor: pal[i % pal.length], data: DATES.map(d => Rc.filter(o => o.date_collecte === d && o.contrat === k).length) })) },
    options: { scales: { x: { stacked: true }, y: { stacked: true, beginAtZero: true, title: { display: true, text: 'Offres retenues' } } } } });
  const tous = [...RET, ...ECA].filter(o => !F.canal || o.canal === F.canal);
  const parLien = {}; tous.forEach(o => { (parLien[o.lien] = parLien[o.lien] || []).push(o); });
  const pers = Object.values(parLien).filter(l => new Set(l.map(o => o.date_collecte)).size > 1);
  const n0 = DATES.length > 1 ? tous.filter(o => o.date_collecte === DATES[DATES.length - 1]).length : 0;
  document.getElementById('l-evolution').innerHTML = DATES.length > 1 ? `Sur les ${n0} offres relevées le ${dateFr(DATES[DATES.length - 1])}, <b>${pers.length}</b> étaient déjà en ligne à un relevé précédent : le marché se renouvelle vite.` : '';
  document.getElementById('t-persistantes').innerHTML = `<tr><th>Offre</th><th>Entreprise</th><th>Contrat</th><th>Relevés</th></tr>` +
    pers.map(l => { const o = l[l.length - 1]; return `<tr><td><a href="${esc(o.lien)}" target="_blank" rel="noopener">${esc(o.intitule)}</a></td><td>${esc(o.entreprise)}</td><td>${esc(o.contrat)}</td><td>${[...new Set(l.map(x => dateFr(x.date_collecte)))].join(', ')}</td></tr>`; }).join('');

  rendreFT(F);

  // Tableau des offres
  const T = R.filter(o => !F.texte || [o.intitule, o.entreprise, o.lieu, o.secteur].join(' ').toLowerCase().includes(F.texte));
  document.getElementById('compte').textContent = `${T.length} offre${T.length > 1 ? 's' : ''} affichée${T.length > 1 ? 's' : ''}`;
  document.getElementById('t-offres').innerHTML = `<tr><th>Date</th><th>Canal</th><th>Contrat</th><th>Intitulé</th><th>Entreprise</th><th>Lieu</th><th class="n">Salaire</th></tr>` +
    T.map(o => { const m = milieu(o); return `<tr><td>${dateFr(o.date_collecte)}</td><td><span class="pastille">${o.canal === 'Adzuna' ? 'Adzuna' : 'WTTJ'}</span></td><td>${esc(o.contrat)}</td><td><a href="${esc(o.lien)}" target="_blank" rel="noopener">${esc(o.intitule)}</a></td><td>${esc(o.entreprise)}</td><td>${esc(o.lieu)}</td><td class="n">${m == null ? '' : eur(m) + (o.salaire_periode === 'mois' ? '/mois' : '/an')}</td></tr>`; }).join('');
}

// ---- France Travail : data/resume.json, produit chaque jour par le robot du prof ----
let FT = null;
const CLERMONT = /\b63\d{3}\b|clermont|aubi[eè]re|chamali[eè]res|gerzat|cournon|riom|issoire|beaumont|saint-beauzire|pont-du-ch[aâ]teau/i;
function ftContrat(o) {
  if (o.nature === 'apprentissage' || o.nature === 'professionnalisation') return 'Alternance';
  if (o.nature === 'non_salarie') return 'Indépendant (non salarié)';
  return { CDI: 'CDI', DDI: 'CDI', CDD: 'CDD', MIS: 'Intérim', SAI: 'Saisonnier' }[o.contrat] || o.contrat || 'Non précisé';
}
const ftMilieu = o => o.smin == null ? null : o.smax == null ? o.smin : (o.smin + o.smax) / 2;
const mediane = v => { const s = v.filter(x => x != null).sort((a, b) => a - b), n = s.length; return n ? (n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2) : null; };

function rendreFT(F) {
  if (!FT) return;
  const groupes = document.getElementById('f-groupe').value.split(',');
  const codes = new Set(FT.metiers.filter(m => groupes.includes(m.groupe)).map(m => m.code));
  const X = FT.offres.filter(o => codes.has(o.rome));
  document.getElementById('ft-sous').innerHTML = `Offres actives sur France Travail le <b>${dateFr(FT.date)}/${FT.date.slice(0, 4)}</b>, pour ${codes.size} métiers suivis par le prof : <b>${nf(X.length)}</b> offres. Elles se mettent à jour à chaque « Sync fork ».`;

  // Nos colonnes : offres retenues de la date choisie (le filtre canal et contrat ne s'applique pas ici).
  const quand = F.date ? `le ${dateFr(F.date)}` : 'tous relevés';
  const col = c => {
    const R = RET.filter(o => o.canal === c && (!F.date || o.date_collecte === F.date));
    const E = ECA.filter(o => o.canal === c && (!F.date || o.date_collecte === F.date));
    const tot = R.length + E.length;
    return { n: R.length, rel: tot, connu: pct(tot - E.filter(inconnu).length, tot),
      sal: pct(R.filter(o => milieu(o) != null).length, R.length),
      medCDI: mediane(R.filter(o => o.contrat === 'CDI').map(milieu)), nCDI: R.filter(o => o.contrat === 'CDI' && milieu(o) != null).length,
      cdi: pct(R.filter(o => o.contrat === 'CDI').length, R.length), alt: pct(R.filter(o => o.contrat === 'Alternance').length, R.length),
      stage: pct(R.filter(o => o.contrat === 'Stage').length, R.length),
      paris: pct(R.filter(o => ville(o.lieu) === 'Paris').length, R.length), pdd: R.filter(o => CLERMONT.test(o.lieu)).length };
  };
  const cdiFT = X.filter(o => ftContrat(o) === 'CDI');
  const ft = { n: X.length, rel: X.length, connu: pct(X.filter(o => o.contrat).length, X.length), sal: pct(X.filter(o => o.smin != null).length, X.length),
    medCDI: mediane(cdiFT.map(ftMilieu)), nCDI: cdiFT.filter(o => o.smin != null).length,
    cdi: pct(cdiFT.length, X.length), alt: pct(X.filter(o => ftContrat(o) === 'Alternance').length, X.length),
    stage: 0, paris: pct(X.filter(o => o.dep === '75').length, X.length), pdd: X.filter(o => o.dep === '63').length };
  const w = col('Welcome to the Jungle'), a = col('Adzuna');
  const lignes = [
    ['Offres analysées', c => nf(c.n)],
    ['Contrat indiqué', c => c.connu + ' %'],
    ['Salaire affiché', c => c.sal + ' %'],
    ['Salaire médian des CDI (brut annuel)', c => c.medCDI == null ? '–' : `${eur(c.medCDI)} <small>(n=${c.nCDI})</small>`],
    ['Part de CDI', c => c.cdi + ' %'],
    ['Part d\'alternances', c => c.alt + ' %'],
    ['Part de stages', c => c.stage + ' %'],
    ['Part à Paris (75)', c => c.paris + ' %'],
    ['Offres dans le Puy-de-Dôme', c => nf(c.pdd)],
  ];
  document.getElementById('t-comparaison').innerHTML =
    `<tr><th></th><th class="n">France Travail<br><small>${dateFr(FT.date)}, toutes les offres</small></th><th class="n">Welcome to the Jungle<br><small>${quand}, notre relevé</small></th><th class="n">Adzuna<br><small>${quand}, notre relevé</small></th></tr>` +
    lignes.map(([t, f]) => `<tr><td>${t}</td><td class="n">${f(ft)}</td><td class="n">${f(w)}</td><td class="n">${f(a)}</td></tr>`).join('');
  document.getElementById('n-comparaison').innerHTML = `Pour nos canaux, les parts sont calculées sur les offres retenues après nettoyage (sauf « contrat indiqué », calculé sur toutes les offres relevées). Les trois listes Welcome to the Jungle ne montrent chacune qu'un type de contrat : ses parts de CDI, de stages et d'alternances reflètent notre choix de pages, pas le marché. France Travail compte comme alternance les contrats d'apprentissage et de professionnalisation.`;

  const ks = {}; X.forEach(o => { const k = ftContrat(o); ks[k] = (ks[k] || 0) + 1; });
  const tk = Object.entries(ks).sort((p, q) => q[1] - p[1]);
  dessiner('g-ft-contrats', { type: 'bar', data: { labels: tk.map(t => t[0]), datasets: [{ data: tk.map(t => t[1]), backgroundColor: css('--vert') }] },
    options: { indexAxis: 'y', plugins: { legend: { display: false } }, scales: { x: { beginAtZero: true, title: { display: true, text: `Nombre d'offres (total : ${nf(X.length)})` } }, y: { ticks: { autoSkip: false } } } } });
  const nAlt = ks['Alternance'] || 0;
  document.getElementById('l-ft-contrats').innerHTML = `Sur France Travail, <b>${pct(cdiFT.length, X.length)} %</b> des offres sont des CDI et <b>${pct(nAlt, X.length)} %</b> des alternances (${nf(nAlt)} offres). Nos relevés n'étant qu'un échantillon (une page par liste), on compare les parts, pas les volumes.`;
  const kd = {}; X.forEach(o => { if (o.dep) kd[o.dep] = (kd[o.dep] || 0) + 1; });
  const td = Object.entries(kd).sort((p, q) => q[1] - p[1]).slice(0, 10);
  dessiner('g-ft-dep', { type: 'bar', data: { labels: td.map(t => 'Dép. ' + t[0]), datasets: [{ data: td.map(t => t[1]), backgroundColor: td.map(t => t[0] === '63' ? css('--orange') : css('--vert')) }] },
    options: { plugins: { legend: { display: false } }, scales: { y: { beginAtZero: true, title: { display: true, text: "Nombre d'offres" } } } } });
  const r63 = Object.entries(kd).sort((p, q) => q[1] - p[1]).findIndex(t => t[0] === '63') + 1;
  document.getElementById('l-ft-dep').innerHTML = `Paris (75) concentre <b>${pct(kd['75'] || 0, X.length)} %</b> des offres. Le Puy-de-Dôme (63) en compte <b>${nf(kd['63'] || 0)}</b>${r63 ? `, ${r63}<sup>e</sup> département` : ''}.`;
}

(async () => {
  try {
    DATES = await (await fetch('dates.json')).json();
    for (const d of DATES) {
      RET.push(...await charger(`${DATA}offres_finales/offres_finales_${d}.csv`));
      ECA.push(...await charger(`${DATA}offres_ecartees/offres_ecartees_${d}.csv`));
    }
    const sd = document.getElementById('f-date');
    sd.innerHTML = DATES.slice().reverse().map(d => `<option value="${d}">${dateFr(d)}/${d.slice(0, 4)}</option>`).join('') + '<option value="">Toutes les dates</option>';
    const sc = document.getElementById('f-contrat');
    [...new Set(RET.map(o => o.contrat))].sort().forEach(c => sc.add(new Option(c, c)));
    ['f-date', 'f-canal', 'f-contrat'].forEach(id => document.getElementById(id).addEventListener('change', rendre));
    document.getElementById('f-texte').addEventListener('input', rendre);
    document.getElementById('f-groupe').addEventListener('change', () => rendreFT(filtres()));
    rendre();
    // France Travail : chargé après coup, pour que nos données s'affichent tout de suite.
    try {
      FT = await (await fetch(`${DATA}resume.json`)).json();
      rendreFT(filtres());
    } catch (e) {
      document.getElementById('ft-sous').textContent = `Données France Travail indisponibles (${e.message}).`;
    }
  } catch (e) {
    document.getElementById('erreur').innerHTML = `<p class="erreur">Impossible de charger les données : ${esc(e.message)}. Ouvrez la page via GitHub Pages (ou un petit serveur local), pas en double-cliquant sur le fichier.</p>`;
  }
})();
