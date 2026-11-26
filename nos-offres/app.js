// Lit data/offres_finales/ et data/offres_ecartees/ (nos relevés à la main, dates listées dans dates.json)
// et data/auto/ (notre robot, chaque matin, dates listées dans dates_auto.json),
// puis recalcule toute la page selon les filtres.
const DATA = '../data/';
const css = n => getComputedStyle(document.documentElement).getPropertyValue(n).trim();
const COUL = { 'Welcome to the Jungle': () => css('--bleu'), 'Adzuna': () => css('--orange'),
  'La bonne alternance': () => '#8e5bd6', 'France Travail': () => css('--vert') };
const TOUS_CANAUX = ['Welcome to the Jungle', 'Adzuna', 'La bonne alternance', 'France Travail'];
const COURT = { 'Welcome to the Jungle': 'WTTJ', 'Adzuna': 'Adzuna', 'La bonne alternance': 'LBA', 'France Travail': 'FT' };
let CANAUX = TOUS_CANAUX;                    // réduit aux canaux présents dans les données, au chargement
const AFFICHAGE_MAX = 500;                   // lignes du tableau « Toutes les offres » (le reste via la recherche)
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
  const cs = CANAUX.filter(c => !F.canal || c === F.canal);  dessiner('g-retenues', { type: 'bar', data: { labels: cs, datasets: [
    { label: 'Retenues', data: cs.map(c => Rsc.filter(o => o.canal === c).length), backgroundColor: css('--vert') },
    { label: 'Écartées', data: cs.map(c => E.filter(o => o.canal === c).length), backgroundColor: css('--gris') } ] },
    options: { scales: { x: { stacked: true }, y: { stacked: true, beginAtZero: true, title: { display: true, text: "Nombre d'offres" } } } } });
  const ad = c => [Rsc.filter(o => o.canal === c).length, E.filter(o => o.canal === c).length];
  const partsGardees = cs.map(c => { const [r, e] = ad(c); return [c, r, r + e]; }).filter(t => t[2]);
  document.getElementById('l-retenues').innerHTML = partsGardees.length > 1
    ? 'Part des offres gardées : ' + partsGardees.map(([c, r, t]) => `<b>${pct(r, t)} %</b> pour ${esc(c)} (${nf(r)} sur ${nf(t)})`).join(', ') + '. Les agrégateurs ramènent beaucoup d\'offres hors marketing ou sans contrat.'
    : `${nf(Rsc.length)} offres retenues sur ${nf(relevees)} relevées.`;

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
  const sansContrat = cs.map(c => { const [a, b] = connus(c); return [c, b, a + b]; }).filter(t => t[2]);
  document.getElementById('l-connu').innerHTML = sansContrat.length
    ? 'Annonces qui ne précisent pas le contrat : ' + sansContrat.map(([c, b, t]) => `<b>${pct(b, t)} %</b> chez ${esc(c)} (${nf(b)} sur ${nf(t)})`).join(', ') + '.'
    : '';

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
  document.getElementById('compte').textContent = `${nf(T.length)} offre${T.length > 1 ? 's' : ''}` +
    (T.length > AFFICHAGE_MAX ? ` — les ${AFFICHAGE_MAX} premières sont affichées, utilisez la recherche ou les filtres pour les autres` : ` affichée${T.length > 1 ? 's' : ''}`);
  // Adzuna exige que chaque annonce affichée porte le mot « Adzuna », en lien vers son site (conditions de l'API).
  const pastille = c => c === 'Adzuna' ? '<a class="pastille adzuna" href="https://www.adzuna.fr" target="_blank" rel="noopener">Adzuna</a>' : `<span class="pastille">${esc(COURT[c] || c)}</span>`;
  document.getElementById('t-offres').innerHTML = `<tr><th>Date</th><th>Canal</th><th>Contrat</th><th>Intitulé</th><th>Entreprise</th><th>Lieu</th><th class="n">Salaire</th></tr>` +
    T.slice(0, AFFICHAGE_MAX).map(o => { const m = milieu(o); return `<tr><td>${dateFr(o.date_collecte)}</td><td>${pastille(o.canal)}</td><td>${esc(o.contrat)}</td><td><a href="${esc(o.lien)}" target="_blank" rel="noopener">${esc(o.intitule)}</a></td><td>${esc(o.entreprise)}</td><td>${esc(o.lieu)}</td><td class="n">${m == null ? '' : eur(m) + (o.salaire_periode === 'mois' ? '/mois' : '/an')}</td></tr>`; }).join('');
}

// ---- France Travail : data/resume.json, produit chaque jour par le robot du prof ----
let FT = null;
const CLERMONT = /\b63\d{3}\b|puy-de-d[oô]me|clermont|aubi[eè]re|chamali[eè]res|gerzat|cournon|riom|issoire|beaumont|saint-beauzire|pont-du-ch[aâ]teau/i;
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
  const nos = CANAUX.map(c => [c, col(c)]).filter(([, v]) => v.rel > 0);   // seulement les canaux relevés à cette date
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
    `<tr><th></th><th class="n">France Travail — robot du prof<br><small>${dateFr(FT.date)}, codes ROME</small></th>` +
    nos.map(([c]) => `<th class="n">${esc(c)}${c === 'France Travail' ? ' — notre robot' : ''}<br><small>${quand}, ${c === 'Welcome to the Jungle' ? 'notre relevé' : c === 'France Travail' ? 'mot-clé « marketing »' : 'nos relevés'}</small></th>`).join('') + '</tr>' +
    lignes.map(([t, f]) => `<tr><td>${t}</td><td class="n">${f(ft)}</td>${nos.map(([, v]) => `<td class="n">${f(v)}</td>`).join('')}</tr>`).join('');
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
  rendreClermont(F);
}

// ---- Clermont : BMO 2026 (intentions des employeurs) face aux offres en ligne ----
let BMO = [];
// Familles BMO retenues comme « marketing et communication » (les autres sont la vente).
const BMO_MKT = ['R3X83', 'R4X90', 'U0X80', 'U0X90', 'U1X82'];
// Même règle pour les trois sites : l'intitulé doit parler de marketing ou de communication.
const VRAI_MKT = /marketing|communication|community|digital|num[ée]rique|chef de produit|e-commerce|\bweb\b|social media|marque|relations publiques|\bseo\b|influen/i;
function rendreClermont(F) {
  if (!BMO.length) return;
  const b = (code, t) => BMO.find(r => r.code_metier_bmo === code && r.territoire === t) || {};
  const num = v => +v || 0;
  const codes = [...new Set(BMO.map(r => r.code_metier_bmo))].sort((p, q) => num(b(q, 'Bassin de Clermont-Ferrand').projets_recrutement) - num(b(p, 'Bassin de Clermont-Ferrand').projets_recrutement));
  document.getElementById('t-bmo').innerHTML = `<tr><th>Métier (famille BMO)</th><th class="n">Bassin de Clermont</th><th class="n">dont difficiles</th><th class="n">Puy-de-Dôme</th></tr>` +
    codes.map(c => { const r = b(c, 'Bassin de Clermont-Ferrand'), d = b(c, 'Puy-de-Dôme'), p = num(r.projets_recrutement);
      return `<tr><td>${esc(r.metier_bmo)} ${BMO_MKT.includes(c) ? '' : '<span class="pastille">vente</span>'}</td><td class="n">${nf(p)}</td><td class="n">${p ? r.part_difficiles_pct + ' %' : '–'}</td><td class="n">${nf(num(d.projets_recrutement))}</td></tr>`; }).join('');

  const prevu = BMO_MKT.reduce((s, c) => s + num(b(c, 'Bassin de Clermont-Ferrand').projets_recrutement), 0);
  const diff = BMO_MKT.reduce((s, c) => s + num(b(c, 'Bassin de Clermont-Ferrand').dont_difficiles), 0);
  const com = num(b('U0X80', 'Bassin de Clermont-Ferrand').projets_recrutement), comD = b('U0X80', 'Bassin de Clermont-Ferrand').part_difficiles_pct;
  const ft63 = FT ? FT.offres.filter(o => o.dep === '63') : [];
  const ftVrai = ft63.filter(o => VRAI_MKT.test(o.intitule));
  const quand = F.date ? `le ${dateFr(F.date)}` : 'tous relevés';
  const nous = c => { const l = RET.filter(o => o.canal === c && (!F.date || o.date_collecte === F.date)); const loc = l.filter(o => CLERMONT.test(o.lieu)); return [l.length, loc.length, loc.filter(o => VRAI_MKT.test(o.intitule)).length]; };
  const [, , wv] = nous('Welcome to the Jungle');
  document.getElementById('t-prevu').innerHTML = `<tr><th>Source</th><th class="n">Clermont / Puy-de-Dôme</th><th class="n">dont vraiment marketing / com</th></tr>` +
    `<tr><td>Employeurs (BMO 2026) <small>— projets prévus sur l'année, bassin de Clermont</small></td><td class="n">${nf(prevu)}</td><td class="n">${nf(prevu)}</td></tr>` +
    `<tr><td>France Travail <small>— offres actives le ${FT ? dateFr(FT.date) : '…'}, 23 métiers du prof</small></td><td class="n">${FT ? nf(ft63.length) : '…'}</td><td class="n">${FT ? nf(ftVrai.length) : '…'}</td></tr>` +
    CANAUX.map(c => { const [n, l, v] = nous(c);
      if (!n && !ECA.some(o => o.canal === c && (!F.date || o.date_collecte === F.date))) return '';
      return `<tr><td>${esc(c)}${c === 'France Travail' ? ' (notre robot)' : ''} <small>— ${quand}, sur ${nf(n)} offres retenues</small></td><td class="n">${nf(l)}</td><td class="n">${nf(v)}</td></tr>`; }).join('');
  document.getElementById('l-prevu').innerHTML = `Les employeurs du bassin clermontois prévoient <b>${nf(prevu)} recrutements</b> en marketing et communication en 2026 (${pct(diff, prevu)} % jugés difficiles), dont <b>${nf(com)} assistants de communication</b> (${comD} % difficiles). ` +
    (FT ? `Sur France Travail, seules <b>${ftVrai.length}</b> offres actives du Puy-de-Dôme ont un intitulé vraiment marketing ou communication. ` : '') +
    `Welcome to the Jungle n'en a ${wv ? wv : 'aucune'} dans nos relevés : le site est tourné vers Paris. La plupart de ces recrutements ne passent donc par aucune annonce visible.`;

  document.getElementById('t-ft63').innerHTML = `<tr><th>Intitulé</th><th>Code ROME (métier du prof)</th><th>Lieu</th><th>Contrat</th><th>Vraiment marketing / com ?</th></tr>` +
    ft63.map(o => { const m = FT.metiers.find(x => x.code === o.rome); return `<tr><td><a href="${esc(o.url)}" target="_blank" rel="noopener">${esc(o.intitule)}</a></td><td>${esc(o.rome)} ${esc(m ? m.libelle : '')}</td><td>${esc(o.lieu)}</td><td>${esc(ftContrat(o))}</td><td>${VRAI_MKT.test(o.intitule) ? '✔ oui' : '✘ non'}</td></tr>`; }).join('');
  document.getElementById('n-ft63').innerHTML = FT ? `${ft63.length} offres du Puy-de-Dôme sont rangées par France Travail dans les 23 métiers du prof, mais <b>${ft63.length - ftVrai.length}</b> n'ont rien de marketing dans leur intitulé (un médecin, des études de réseaux électriques… classés en « chargé d'études commerciales »). Le code métier choisi par l'employeur n'est pas toujours fiable : c'est une limite de la source France Travail. Règle appliquée aux trois sites : l'intitulé contient marketing, communication, digital, web, e-commerce, chef de produit, community, marque, relations publiques, SEO ou influence.` : '';
}

(async () => {
  try {
    const manuelles = await (await fetch('dates.json')).json();
    let auto = [];
    try { const r = await fetch('dates_auto.json'); if (r.ok) auto = await r.json(); } catch (e) { /* pas encore de robot */ }
    // Tous les fichiers en parallèle : relevés à la main + jours du robot.
    const lots = await Promise.all([
      ...manuelles.flatMap(d => [charger(`${DATA}offres_finales/offres_finales_${d}.csv`), charger(`${DATA}offres_ecartees/offres_ecartees_${d}.csv`)]),
      ...auto.flatMap(d => [charger(`${DATA}auto/offres_finales_${d}.csv`), charger(`${DATA}auto/offres_ecartees_${d}.csv`)]),
    ]);
    lots.forEach((l, i) => (i % 2 ? ECA : RET).push(...l));
    DATES = [...new Set([...manuelles, ...auto])].sort();
    CANAUX = TOUS_CANAUX.filter(c => RET.some(o => o.canal === c) || ECA.some(o => o.canal === c));
    const fc = document.getElementById('f-canal');
    fc.innerHTML = `<option value="">Tous les canaux</option>` + CANAUX.map(c => `<option>${esc(c)}</option>`).join('');
    const sd = document.getElementById('f-date');
    sd.innerHTML = DATES.slice().reverse().map(d => `<option value="${d}">${dateFr(d)}/${d.slice(0, 4)}</option>`).join('') + '<option value="">Toutes les dates</option>';
    const sc = document.getElementById('f-contrat');
    [...new Set(RET.map(o => o.contrat))].sort().forEach(c => sc.add(new Option(c, c)));
    ['f-date', 'f-canal', 'f-contrat'].forEach(id => document.getElementById(id).addEventListener('change', rendre));
    document.getElementById('f-texte').addEventListener('input', rendre);
    document.getElementById('f-groupe').addEventListener('change', () => rendreFT(filtres()));
    try { BMO = await charger(`${DATA}bmo_2026_marketing.csv`); } catch (e) { document.getElementById('l-prevu').textContent = `Données BMO indisponibles (${e.message}).`; }
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
