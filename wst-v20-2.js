/* ============================================================
   Web Studio Tycoon — wst-v20.js : étape 1 « fluidité »
   Chargé APRÈS wst-v19.js. N'écrit PAS dans G, ne change aucune
   règle du jeu. Tout est dans des try/catch : si un élément manque,
   le jeu continue comme avant.
   ============================================================ */
(function () {
  'use strict';
  function safe(fn) { try { fn(); } catch (e) { try { console.warn('[wst20]', e); } catch (_) {} } }

  /* --- 1) Ne redessiner que l'écran visible ------------------
     render() reconstruisait TOUS les écrans à chaque action.
     On enveloppe chaque renderX : s'il n'est pas à l'écran, on
     saute. Quand on ouvre l'écran (showTab), on le redessine. */
  var TAB_OF = {
    renderSites: 'sitesapps', renderApps: 'sitesapps',
    renderDepannage: 'depannage', renderHomeTiles: 'sites',
    renderTrainings: 'trainings', renderTraining: 'training',
    renderCreate: 'create', renderMarket: 'market', renderRanking: 'ranking',
    renderTeam: 'team', renderUpgrades: 'office', renderStats: 'stats',
    renderHelp: 'help', renderJournal: 'journal', renderShop: 'shop',
    renderDarkweb: 'darkweb', renderFeaturesHub: 'features'
  };
  function curTab() { try { return currentTab; } catch (e) { return null; } }

  safe(function () {
    Object.keys(TAB_OF).forEach(function (name) {
      var orig = window[name];
      if (typeof orig !== 'function' || orig.__wst20) return;
      var w = function () {
        if (curTab() !== TAB_OF[name]) return;   // écran caché : on saute
        return orig.apply(this, arguments);
      };
      w.__wst20 = true; w.__orig = orig;
      window[name] = w;
    });

    /* La messagerie met aussi à jour la pastille 💬 de la barre du
       bas : on garde cette partie même quand l'écran est caché. */
    var origMsg = window.renderMessages;
    if (typeof origMsg === 'function' && !origMsg.__wst20) {
      var wm = function () {
        if (curTab() === 'messages') return origMsg.apply(this, arguments);
        safe(function () {
          var n = msgUnread();
          var b = document.getElementById('msgBadge');
          if (b) { b.textContent = n; b.classList.toggle('hidden', n == 0); }
          var cm = document.getElementById('cntMsg'); if (cm) cm.textContent = n;
        });
      };
      wm.__wst20 = true; window.renderMessages = wm;
    }

    /* À l'ouverture d'un écran, on le redessine (une seule fois). */
    var origShow = window.showTab;
    if (typeof origShow === 'function' && !origShow.__wst20) {
      var ws = function (id) {
        var r = origShow.apply(this, arguments);
        safe(function () {
          Object.keys(TAB_OF).forEach(function (name) {
            if (TAB_OF[name] === id) {
              if (name === 'renderTraining') { if (typeof selectedTrainingId !== 'undefined' && selectedTrainingId) window[name](selectedTrainingId); }
              else window[name]();
            }
          });
        });
        return r;
      };
      ws.__wst20 = true; window.showTab = ws;
    }
  });

  /* --- 2) Sauvegarde groupée ----------------------------------
     save() écrivait tout le JSON à chaque clic. On regroupe : une
     écriture au maximum toutes les 400 ms, et on sauvegarde tout de
     suite quand l'onglet se ferme ou passe en arrière-plan. */
  safe(function () {
    var origSave = window.save;
    if (typeof origSave !== 'function' || origSave.__wst20) return;
    var timer = null;
    function flush() { if (timer) { clearTimeout(timer); timer = null; try { origSave(); } catch (e) {} } }
    var ws = function () { if (!timer) timer = setTimeout(flush, 400); };
    ws.__wst20 = true; window.save = ws;
    document.addEventListener('visibilitychange', function () { if (document.visibilityState === 'hidden') flush(); });
    window.addEventListener('pagehide', flush);
    window.addEventListener('beforeunload', flush);
  });

  /* --- 3) Ne pas retoucher le DOM si rien n'a changé -----------
     Le bureau, la mascotte et l'avatar étaient réécrits à chaque
     render() : relecture HTML + redessin pour rien. */
  safe(function () {
    var desc = Object.getOwnPropertyDescriptor(Element.prototype, 'innerHTML');
    if (!desc || !desc.set) return;
    ['officeScene', 'mascotBox', 'playerAvatar', 'loginHeroBox', 'loginMascotBox'].forEach(function (id) {
      var el = document.getElementById(id);
      if (!el || el.__wst20) return;
      var last = null;
      Object.defineProperty(el, 'innerHTML', {
        configurable: true,
        get: function () { return desc.get.call(this); },
        set: function (v) { v = String(v); if (v === last) return; last = v; desc.set.call(this, v); }
      });
      el.__wst20 = true;
    });
  });
})();

/* ============================================================
   ÉTAPE 2 — ATELIER 3D : tour complète, lumière dynamique, ombre,
   rotation fluide avec inertie. Aucune logique de réparation
   n'est modifiée : seulement la caméra et l'habillage.
   ============================================================ */
(function () {
  'use strict';
  function safe(fn) { try { fn(); } catch (e) { try { console.warn('[wst20-3d]', e); } catch (_) {} } }
  var reduce = false;
  safe(function () { reduce = !!(window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches); });

  /* Lumière fixe en haut à gauche, devant (x droite, y bas, z vers nous) */
  var L = (function () { var x = -0.45, y = -0.55, z = 0.70, n = Math.sqrt(x * x + y * y + z * z); return [x / n, y / n, z / n]; })();
  function lum(nx, ny, nz, ry, rx) {
    var cy = Math.cos(ry), sy = Math.sin(ry), cx = Math.cos(rx), sx = Math.sin(rx);
    var x1 = nx * cy + nz * sy, z1 = -nx * sy + nz * cy;          // rotateY
    var y2 = ny * cx - z1 * sx, z2 = ny * sx + z1 * cx;           // rotateX
    var d = x1 * L[0] + y2 * L[1] + z2 * L[2];
    return +((1 - (0.3 + 0.7 * Math.max(0, d))) * 0.62).toFixed(3);
  }

  function curRot() { try { return [wsRotX, wsRotY]; } catch (e) { return [-6, 32]; } }
  function setRot(x, y) { try { wsRotX = x; wsRotY = y; } catch (e) {} }

  function applyRot() {
    var t = document.getElementById('wsTower'); if (!t) return;
    var r = curRot(), rx = r[0], ry = r[1];
    t.style.transform = 'rotateX(' + rx + 'deg) rotateY(' + ry + 'deg)';
    var a = ry * Math.PI / 180, b = rx * Math.PI / 180, s = t.style;
    s.setProperty('--shF', lum(0, 0, 1, a, b));
    s.setProperty('--shB', lum(0, 0, -1, a, b));
    s.setProperty('--shL', lum(-1, 0, 0, a, b));
    s.setProperty('--shR', lum(1, 0, 0, a, b));
    s.setProperty('--shT', lum(0, -1, 0, a, b));
    s.setProperty('--shD', lum(0, 1, 0, a, b));
    var w = t.parentNode;
    if (w && w.style) {
      w.style.setProperty('--shx', (-Math.sin(a) * 14).toFixed(1) + 'px');
      w.style.setProperty('--shs', (1 + 0.28 * Math.abs(Math.sin(a))).toFixed(3));
    }
  }
  window.wsApplyRot = applyRot;

  /* Une seule mise à jour par image, quoi qu'il arrive. */
  var pending = 0;
  function schedule() { if (pending) return; pending = requestAnimationFrame(function () { pending = 0; applyRot(); }); }

  /* --- Animations (inertie / glissement vers un angle) --- */
  var anim = 0;
  function stopAnim() { if (anim) { cancelAnimationFrame(anim); anim = 0; } }
  function inertia(v) {
    stopAnim(); if (reduce) return;
    var last = performance.now();
    (function step(now) {
      var dt = Math.min(40, now - last); last = now;
      v *= Math.pow(0.94, dt / 16.7);
      if (Math.abs(v) < 0.004) { anim = 0; return; }
      var r = curRot(); setRot(r[0], r[1] + v * dt); applyRot();
      anim = requestAnimationFrame(step);
    })(last);
  }
  function tweenY(target, ms) {
    stopAnim();
    var r = curRot(), from = r[1];
    if (reduce) { setRot(r[0], target); applyRot(); return; }
    var t0 = performance.now();
    (function step(now) {
      var k = Math.min(1, (now - t0) / ms), e = 1 - Math.pow(1 - k, 3);
      var rr = curRot(); setRot(rr[0], from + (target - from) * e); applyRot();
      anim = k < 1 ? requestAnimationFrame(step) : 0;
    })(t0);
  }
  function norm(y) { return ((y + 180) % 360 + 360) % 360 - 180; }

  /* --- Glisser pour tourner : tour complète à 360°, inclinaison élargie --- */
  var drag = null, moved = false, vel = 0, lastX = 0, lastT = 0, lastMoveEnd = 0;
  window.wsDragStart = function (e) {
    stopAnim();
    var r = curRot();
    drag = { x: e.clientX, y: e.clientY, rotY: r[1], rotX: r[0], id: e.pointerId, el: e.currentTarget };
    moved = false; vel = 0; lastX = e.clientX; lastT = performance.now();
    try { wsDrag = drag; } catch (_) {}
  };
  window.wsDragMove = function (e) {
    if (!drag) return;
    var dx = e.clientX - drag.x, dy = e.clientY - drag.y;
    if (!moved) {
      if (Math.abs(dx) + Math.abs(dy) < 6) return;           // simple tap : on laisse passer
      moved = true;
      try { drag.el.setPointerCapture(drag.id); } catch (_) {} // capture seulement quand on glisse
    }
    var now = performance.now(), dt = Math.max(1, now - lastT);
    vel = vel * 0.6 + ((e.clientX - lastX) * 0.5 / dt) * 0.4;
    lastX = e.clientX; lastT = now;
    setRot(Math.max(-35, Math.min(25, drag.rotX + dy * 0.25)), drag.rotY + dx * 0.5);
    schedule();
  };
  window.wsDragEnd = function () {
    var was = moved, v = vel;
    drag = null; try { wsDrag = null; } catch (_) {}
    if (was) {
      lastMoveEnd = performance.now();
      if (performance.now() - lastT < 80 && Math.abs(v) > 0.02) inertia(v);
    }
    moved = false;
  };
  /* Après un glissement, le « clic » fantôme ne doit pas choisir une pièce. */
  safe(function () {
    var tap = window.wsTapPart;
    if (typeof tap === 'function' && !tap.__wst20) {
      var w = function () { if (performance.now() - lastMoveEnd < 350) return false; return tap.apply(this, arguments); };
      w.__wst20 = true; window.wsTapPart = w;
    }
  });

  /* Boutons ↺ / ↻ : rotation douce, sans limite */
  window.wsRotate = function (d) { var r = curRot(); tweenY(norm(r[1]) + d * 2, 380); };

  /* Ouvrir le panneau : la caméra se place sur le côté ouvert. */
  safe(function () {
    var tp = window.wsTogglePanel;
    if (typeof tp === 'function' && !tp.__wst20) {
      var w = function () {
        var r = tp.apply(this, arguments);
        try { if (wsPanelOpen) { var y = norm(curRot()[1]); if (y < 30 || y > 80) tweenY(52, 520); } } catch (_) {}
        return r;
      };
      w.__wst20 = true; window.wsTogglePanel = w;
    }
  });

  /* --- Habillage de la tour après chaque affichage de l'atelier --- */
  safe(function () {
    var orig = window.renderWorkshop;
    if (typeof orig !== 'function' || orig.__wst20) return;
    var w = function () {
      var r = orig.apply(this, arguments);
      safe(function () {
        var t = document.getElementById('wsTower');
        if (!t || t.querySelector('.wsBack')) return;
        t.insertAdjacentHTML('afterbegin', '<div class="wsFace wsRight"></div><div class="wsFace wsBack"></div><div class="wsFace wsBottom"></div>');
        var wrap = t.parentNode;
        if (wrap && !wrap.querySelector('.wsShadow')) wrap.insertAdjacentHTML('afterbegin', '<div class="wsShadow"></div>');
        applyRot();
      });
      return r;
    };
    w.__wst20 = true; window.renderWorkshop = w;
  });
})();
