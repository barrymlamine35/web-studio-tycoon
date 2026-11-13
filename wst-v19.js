/* ============================================================
   Web Studio Tycoon — wst-v19.js : patch visuel Aurora UI (v19)
   Chargé APRÈS le script du jeu. Il ENVELOPPE les fonctions
   globales showTab, toast, officeSVG et render (sans les
   réécrire) et ajoute : argent qui clignote, +$ flottant,
   bureau de nuit (cycle lié à G.day), écrans de chargement.
   Contraintes respectées : tout dans des try/catch, aucune
   dépendance externe, aucune modification de G ni des
   sauvegardes, fonctionne hors ligne. AUCUN libellé ajouté
   à la barre du bas (icônes seules). AUCUN changement de
   taille de bouton. AUCUN changement de logique du jeu.
   ============================================================ */
(function () {
  'use strict';

  /* Petit garde-fou : chaque bloc est protégé, le patch ne doit
     jamais casser le jeu, même si un élément est absent. */
  function safe(fn) {
    try { fn(); } catch (e) {
      try { if (typeof console !== 'undefined' && console.warn) console.warn('[wst19]', e); } catch (_) {}
    }
  }

  /* Écrans lourds : un bref voile de chargement à l'ouverture. */
  var HEAVY_TABS = { workshop: 1, darkweb: 1, messages: 1, siteDetail: 1, appDetail: 1, features: 1 };

  /* Cycle jour/nuit lié à G.day : un jour sur deux, le studio
     travaille de nuit (jour pair = nuit). */
  function isNight() {
    try {
      return (typeof G !== 'undefined') && G && (typeof G.day === 'number') && (G.day % 2 === 0);
    } catch (e) { return false; }
  }

  /* Les deux affichages du solde : carte joueur (#sMoney) et
     barre du haut (#sMoneyM). */
  function moneyEls() {
    var out = [];
    try {
      var a = document.getElementById('sMoney');
      if (a) out.push(a);
      var b = document.getElementById('sMoneyM');
      if (b) out.push(b);
    } catch (e) {}
    return out;
  }

  var lastMoney = null;

  function fmtDelta(d) {
    try {
      if (typeof fmtMoney === 'function') return fmtMoney(Math.abs(d));
    } catch (e) {}
    return Math.abs(d) + ' $';
  }

  /* Quand G.money change : le solde clignote et un +$ (ou -$)
     flotte près du solde. Appelé après chaque render(). */
  function checkMoney() {
    try {
      if (typeof G === 'undefined' || !G) return;
      var m = G.money;
      if (typeof m !== 'number' || isNaN(m)) return;
      if (lastMoney === null) { lastMoney = m; return; }
      if (m === lastMoney) return;
      var delta = m - lastMoney;
      lastMoney = m;
      /* 1) flash du solde (vert si gain, rouge si perte) */
      moneyEls().forEach(function (el) {
        try {
          var pill = null;
          if (el.closest) { try { pill = el.closest('.pill,.tstat'); } catch (e) {} }
          if (!pill) pill = el.parentNode || el;
          var t = pill || el;
          if (!t.classList) return;
          t.classList.remove('wst19-money-flash');
          t.classList.remove('wst19-money-down');
          void t.offsetWidth; /* relance l'animation */
          if (delta < 0) t.classList.add('wst19-money-down');
          t.classList.add('wst19-money-flash');
          setTimeout(function () {
            try { t.classList.remove('wst19-money-flash'); t.classList.remove('wst19-money-down'); } catch (e) {}
          }, 1100);
        } catch (e) {}
      });
      /* 2) +$ / -$ flottant près du solde */
      safe(function () {
        if (!delta) return;
        if (!document.createElement) return;
        var host = document.getElementById('sMoneyM');
        var parent = (host && host.parentNode && host.parentNode.appendChild) ? host.parentNode : document.body;
        if (!parent || !parent.appendChild) return;
        var f = document.createElement('span');
        f.className = 'wst19-float' + (delta < 0 ? ' wst19-float-down' : '');
        f.textContent = (delta > 0 ? '+' : '\u2212') + fmtDelta(delta);
        parent.appendChild(f);
        setTimeout(function () {
          try { if (f.parentNode) f.parentNode.removeChild(f); } catch (e) {}
        }, 1400);
      });
    } catch (e) {}
  }

  /* Écran de chargement : voile bref qui s'efface tout seul. */
  function showLoader(ms) {
    safe(function () {
      if (!document.body || !document.createElement) return;
      var old = document.getElementById('wst19Loader');
      if (old && old.parentNode) old.parentNode.removeChild(old);
      var d = document.createElement('div');
      d.id = 'wst19Loader';
      d.className = 'wst19-loader';
      d.innerHTML = '<div class="wst19-loader-box"><div class="wst19-spinner"></div><div class="wst19-loader-t">Web Studio Tycoon</div><div class="wst19-loader-s">Chargement\u2026</div></div>';
      document.body.appendChild(d);
      var t = (typeof ms === 'number' && ms > 0) ? ms : 350;
      setTimeout(function () { try { d.classList.add('wst19-loader-out'); } catch (e) {} }, t);
      setTimeout(function () { try { if (d.parentNode) d.parentNode.removeChild(d); } catch (e) {} }, t + 400);
    });
  }

  /* --- Enveloppe showTab : voile sur les écrans lourds + onglet
     courant noté sur <body> (crochet CSS pour plus tard). --- */
  safe(function () {
    if (typeof showTab === 'function' && !showTab.__wst19) {
      var origShowTab = showTab;
      var wrappedShowTab = function (id, btn, mode) {
        var r = origShowTab.apply(this, arguments);
        try {
          if (document.body && document.body.setAttribute) document.body.setAttribute('data-wst-tab', String(id));
          if (HEAVY_TABS[id]) showLoader(200);
        } catch (e) {}
        return r;
      };
      wrappedShowTab.__wst19 = true;
      window.showTab = wrappedShowTab;
    }
  });

  /* --- Enveloppe toast : le toast garde son comportement, on
     vérifie juste si l'argent a bougé en même temps. --- */
  safe(function () {
    if (typeof toast === 'function' && !toast.__wst19) {
      var origToast = toast;
      var wrappedToast = function (msg) {
        var r = origToast.apply(this, arguments);
        try {
          var t = document.getElementById('toast');
          if (t && t.classList) t.classList.add('wst19-toast');
          checkMoney();
        } catch (e) {}
        return r;
      };
      wrappedToast.__wst19 = true;
      window.toast = wrappedToast;
    }
  });

  /* --- Enveloppe officeSVG : la nuit (jour pair), on assombrit
     la scène du bureau et on ajoute lune + étoiles. Le jour,
     la scène reste exactement celle du jeu. --- */
  safe(function () {
    if (typeof officeSVG === 'function' && !officeSVG.__wst19) {
      var origOffice = officeSVG;
      var wrappedOffice = function () {
        var s = origOffice.apply(this, arguments);
        try {
          if (typeof s === 'string' && isNight()) {
            var night = '<rect width="760" height="230" fill="#0B1026" opacity="0.42"/>' +
              '<circle cx="688" cy="38" r="16" fill="#FDE68A"/>' +
              '<circle cx="680" cy="32" r="14" fill="#0B1026" opacity="0.55"/>' +
              '<g fill="#FFFFFF"><circle cx="120" cy="26" r="2"/><circle cx="220" cy="18" r="1.6"/><circle cx="330" cy="30" r="2"/><circle cx="470" cy="20" r="1.6"/><circle cx="560" cy="34" r="2"/></g>';
            s = s.replace('</svg>', night + '</svg>');
          }
        } catch (e) {}
        return s;
      };
      wrappedOffice.__wst19 = true;
      window.officeSVG = wrappedOffice;
    }
  });

  /* --- Enveloppe render : après chaque affichage, on vérifie
     si l'argent a changé (flash + +$ flottant). --- */
  safe(function () {
    if (typeof render === 'function' && !render.__wst19) {
      var origRender = render;
      var wrappedRender = function () {
        var r = origRender.apply(this, arguments);
        checkMoney();
        return r;
      };
      wrappedRender.__wst19 = true;
      window.render = wrappedRender;
    }
  });

  /* --- Démarrage : on note le solde actuel (pas de flash au
     chargement) et on montre brièvement l'écran de chargement. --- */
  safe(function () {
    if (typeof G !== 'undefined' && G && typeof G.money === 'number') lastMoney = G.money;
    if (document.body && document.body.setAttribute) {
      var cur = 'sites';
      try { if (typeof currentTab !== 'undefined' && currentTab) cur = String(currentTab); } catch (e) {}
      document.body.setAttribute('data-wst-tab', cur);
    }
    showLoader(500);
  });

  /* API exposée (tests + debug) : ne touche pas au jeu. */
  try {
    window.WST19 = { isNight: isNight, checkMoney: checkMoney, showLoader: showLoader, version: 19 };
  } catch (e) {}
})();
