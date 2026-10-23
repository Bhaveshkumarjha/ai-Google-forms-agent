/* ═══════════════════════════════════════════════════════════════
   FormPilot AI — landing interactions
   8-scene walkthrough:
     mini landing → sign in → Google picker → dashboard →
     chat → preview → confirm → creating → Google Form → success → loop
   ═══════════════════════════════════════════════════════════════ */

(function () {
  "use strict";

  var reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  /* Sticky nav */
  var nav = document.querySelector("[data-nav]");
  if (nav) {
    var onScroll = function () {
      nav.setAttribute("data-scrolled", window.scrollY > 8 ? "true" : "false");
    };
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
  }

  /* Mobile nav */
  var navToggle = document.querySelector("[data-nav-toggle]");
  var navMenu = document.querySelector("[data-nav-menu]");
  if (navToggle && navMenu) {
    navToggle.addEventListener("click", function () {
      var open = navToggle.getAttribute("aria-expanded") === "true";
      navToggle.setAttribute("aria-expanded", String(!open));
      navMenu.setAttribute("data-open", String(!open));
      if (nav) nav.setAttribute("data-open", String(!open));
    });
    navMenu.querySelectorAll("a").forEach(function (a) {
      a.addEventListener("click", function () {
        navToggle.setAttribute("aria-expanded", "false");
        navMenu.setAttribute("data-open", "false");
        if (nav) nav.removeAttribute("data-open");
      });
    });
  }

  /* Reveal on scroll */
  var reveals = Array.prototype.slice.call(document.querySelectorAll(".reveal"));
  if (reveals.length) {
    if (reduceMotion || !("IntersectionObserver" in window)) {
      reveals.forEach(function (el) { el.classList.add("is-in"); });
    } else {
      var revealObs = new IntersectionObserver(function (entries) {
        var visible = entries
          .filter(function (e) { return e.isIntersecting; })
          .map(function (e) { return e.target; });
        visible.forEach(function (el, i) {
          setTimeout(function () {
            el.classList.add("is-in");
            revealObs.unobserve(el);
          }, i * 70);
        });
      }, { rootMargin: "0px 0px -10% 0px", threshold: 0.1 });
      reveals.forEach(function (el) { revealObs.observe(el); });
    }
  }

  /* ═══════════════════════════════════════════════════════════
     ANIMATION
     ═══════════════════════════════════════════════════════════ */
  var chatbot = document.querySelector("[data-chatbot]");
  if (!chatbot) return;

  var cursorEl     = chatbot.querySelector("[data-cb-cursor]");
  var stageEl      = chatbot.querySelector("[data-cb-stage]");
  var statusEl     = chatbot.querySelector("[data-cb-status]");
  var statusTextEl = chatbot.querySelector("[data-cb-status-text]");
  var replayBtn    = chatbot.querySelector("[data-cb-replay]");
  var progressSegs = Array.prototype.slice.call(chatbot.querySelectorAll("[data-cb-seg]"));

  var sceneLanding  = chatbot.querySelector('[data-scene-name="landing"]');
  var scenePicker   = chatbot.querySelector('[data-scene-name="picker"]');
  var sceneDash     = chatbot.querySelector('[data-scene-name="dashboard"]');
  var sceneChat     = chatbot.querySelector('[data-scene-name="chat"]');
  var scenePreview  = chatbot.querySelector('[data-scene-name="preview"]');
  var sceneCreating = chatbot.querySelector('[data-scene-name="creating"]');
  var sceneGform    = chatbot.querySelector('[data-scene-name="gform"]');
  var sceneSuccess  = chatbot.querySelector('[data-scene-name="success"]');

  var miniSigninEls  = Array.prototype.slice.call(chatbot.querySelectorAll("[data-mini-signin]"));
  var primaryAccount = chatbot.querySelector("[data-account-primary]");
  var userMsgEl      = chatbot.querySelector('[data-scene="user-msg"]');
  var userTextEl     = chatbot.querySelector("[data-type-text]");
  var userText       = userTextEl ? userTextEl.getAttribute("data-text") || "" : "";
  var aiThinkingEl   = chatbot.querySelector('[data-scene="ai-thinking"]');
  var aiReplyEl      = chatbot.querySelector('[data-scene="ai-reply"]');
  var loadingLabel   = chatbot.querySelector("[data-cb-loading-label]");
  var formEyebrow    = chatbot.querySelector('[data-scene="form-eyebrow"]');
  var formTitle      = chatbot.querySelector('[data-scene="form-title"]');
  var formSub        = chatbot.querySelector('[data-scene="form-sub"]');
  var formFields     = Array.prototype.slice.call(chatbot.querySelectorAll(".cb-field"));
  var formActions    = chatbot.querySelector('[data-scene="form-actions"]');
  var formNote       = chatbot.querySelector('[data-scene="form-note"]');
  var confirmBtn     = chatbot.querySelector("[data-cb-confirm]");
  var confirmLabel   = chatbot.querySelector("[data-cb-confirm-label]");
  var gformBadge     = chatbot.querySelector("[data-cb-gform-badge]");
  var successIcon    = chatbot.querySelector(".cb-success-icon");
  var successTitle   = chatbot.querySelector(".cb-success-title");
  var successSub     = chatbot.querySelector(".cb-success-sub");
  var linkField      = chatbot.querySelector('[data-scene="link"]');
  var linkTextEl     = chatbot.querySelector("[data-link-text]");
  var linkText       = linkTextEl ? linkTextEl.getAttribute("data-text") || "" : "";
  var successActions = chatbot.querySelector(".cb-success-actions");
  var demoNote       = chatbot.querySelector(".cb-demo-note");
  var copyBtn        = chatbot.querySelector("[data-cb-copy]");
  var copyLabel      = chatbot.querySelector("[data-cb-copy-label]");

  var timers = [];
  var currentRun = 0;
  var started = false;

  function clearTimers() {
    timers.forEach(function (t) { clearTimeout(t); clearInterval(t); });
    timers = [];
  }
  function later(fn, ms) {
    var id = setTimeout(fn, ms);
    timers.push(id);
    return id;
  }
  function setStatus(state, label) {
    if (!statusEl || !statusTextEl) return;
    statusEl.setAttribute("data-state", state);
    statusTextEl.textContent = label;
  }
  function setProgress(idx) {
    progressSegs.forEach(function (seg, i) {
      seg.classList.toggle("is-active", i === idx);
      seg.classList.toggle("is-done", i < idx);
    });
  }
  function show(el) { if (el) el.classList.add("is-in"); }
  function hide(el) { if (el) el.classList.remove("is-in"); }
  function out(el) { if (el) { el.classList.remove("is-in"); el.classList.add("is-out"); } }

  var allScenes = [sceneLanding, scenePicker, sceneDash, sceneChat, scenePreview, sceneCreating, sceneGform, sceneSuccess];
  function showScene(target) {
    allScenes.forEach(function (s) {
      if (!s) return;
      s.classList.remove("is-out");
      if (s === target) s.classList.add("is-in");
      else s.classList.remove("is-in");
    });
  }

  function moveCursorTo(el, offsetX, offsetY) {
    if (!cursorEl || !el || !stageEl) return;
    var stageRect = stageEl.getBoundingClientRect();
    var rect = el.getBoundingClientRect();
    var x = rect.left - stageRect.left + (offsetX != null ? offsetX : rect.width / 2);
    var y = rect.top - stageRect.top + (offsetY != null ? offsetY : rect.height / 2);
    cursorEl.style.transform = "translate(" + x + "px, " + y + "px) scale(1)";
  }
  function showCursor() { if (cursorEl) cursorEl.classList.add("is-visible"); }
  function hideCursor() { if (cursorEl) cursorEl.classList.remove("is-visible"); }
  function cursorPress(cb) {
    if (!cursorEl) { if (cb) cb(); return; }
    cursorEl.classList.add("is-clicking");
    later(function () { cursorEl.classList.remove("is-clicking"); }, 500);
    if (cb) later(cb, 260);
  }

  function typeInto(el, text, speed, done) {
    if (!el || !text) { if (done) done(); return; }
    var i = 0;
    var iv = setInterval(function () {
      i += 1;
      el.textContent = text.slice(0, i);
      if (i >= text.length) {
        clearInterval(iv);
        if (done) done();
      }
    }, speed);
    timers.push(iv);
  }

  function reset() {
    clearTimers();
    currentRun++;

    hideCursor();
    if (cursorEl) cursorEl.style.transform = "translate(-100px, -100px) scale(0.95)";

    miniSigninEls.forEach(function (el) { el.classList.remove("is-hover", "is-pressed"); });
    if (primaryAccount) primaryAccount.classList.remove("is-hover", "is-pressed");

    if (userTextEl) userTextEl.textContent = "";
    if (userMsgEl) userMsgEl.classList.remove("is-in", "is-typing");
    if (aiThinkingEl) aiThinkingEl.classList.remove("is-in");
    if (aiReplyEl) aiReplyEl.classList.remove("is-in");
    if (loadingLabel) loadingLabel.textContent = "Preparing your questions…";

    if (formEyebrow) formEyebrow.classList.remove("is-in");
    if (formTitle) formTitle.classList.remove("is-in");
    if (formSub) formSub.classList.remove("is-in");
    formFields.forEach(function (f) { f.classList.remove("is-in", "is-highlight"); });
    if (formActions) formActions.classList.remove("is-in");
    if (formNote) formNote.classList.remove("is-in");

    if (confirmBtn) confirmBtn.classList.remove("is-pressed");
    if (confirmLabel) confirmLabel.textContent = "Confirm & Create Form";

    if (gformBadge) gformBadge.classList.remove("is-in");

    if (successIcon) successIcon.classList.remove("is-in");
    if (successTitle) successTitle.classList.remove("is-in");
    if (successSub) successSub.classList.remove("is-in");
    if (linkField) linkField.classList.remove("is-in", "is-copied");
    if (linkTextEl) linkTextEl.textContent = "";
    if (successActions) successActions.classList.remove("is-in");
    if (demoNote) demoNote.classList.remove("is-in");
    if (copyLabel) copyLabel.textContent = "Copy Link";

    setStatus("idle", "Ready");
    setProgress(0);
  }

  function play() {
    reset();
    var run = currentRun;

    if (reduceMotion) {
      showScene(sceneSuccess);
      if (successIcon) successIcon.classList.add("is-in");
      if (successTitle) successTitle.classList.add("is-in");
      if (successSub) successSub.classList.add("is-in");
      if (linkField) linkField.classList.add("is-in");
      if (linkTextEl) linkTextEl.textContent = linkText;
      if (successActions) successActions.classList.add("is-in");
      if (demoNote) demoNote.classList.add("is-in");
      setStatus("success", "Done");
      setProgress(7);
      if (replayBtn) replayBtn.hidden = false;
      return;
    }

    /* Scene 0: Mini landing page — cursor clicks Sign in */
    showScene(sceneLanding);
    setStatus("idle", "On the landing page");
    setProgress(0);

    later(function () {
      if (run !== currentRun) return;
      if (cursorEl && stageEl) {
        cursorEl.style.transform = "translate(" + (stageEl.offsetWidth - 30) + "px, " + (stageEl.offsetHeight - 20) + "px) scale(0.95)";
        void cursorEl.offsetWidth;
      }
      showCursor();
    }, 400);

    later(function () {
      if (run !== currentRun) return;
      var target = miniSigninEls[0];
      if (target) moveCursorTo(target, 40, 22);
    }, 700);

    later(function () {
      if (run !== currentRun) return;
      miniSigninEls.forEach(function (el) { el.classList.add("is-hover"); });
    }, 1700);

    later(function () {
      if (run !== currentRun) return;
      miniSigninEls.forEach(function (el) { el.classList.add("is-pressed"); });
      cursorPress(function () {
        if (run !== currentRun) return;
        miniSigninEls.forEach(function (el) { el.classList.remove("is-hover", "is-pressed"); });
        hideCursor();
        scenePickerPlay(run);
      });
    }, 2200);
  }

  /* Scene 1: Google account picker */
  function scenePickerPlay(run) {
    setStatus("busy", "Choose an account");
    setProgress(1);
    showScene(scenePicker);

    later(function () {
      if (run !== currentRun) return;
      showCursor();
      if (primaryAccount) moveCursorTo(primaryAccount, 40, 22);
    }, 300);

    later(function () {
      if (run !== currentRun) return;
      if (primaryAccount) primaryAccount.classList.add("is-hover");
    }, 1200);

    later(function () {
      if (run !== currentRun) return;
      if (primaryAccount) primaryAccount.classList.add("is-pressed");
      cursorPress(function () {
        if (run !== currentRun) return;
        if (primaryAccount) primaryAccount.classList.remove("is-hover", "is-pressed");
        hideCursor();
        sceneDashboardPlay(run);
      });
    }, 2200);
  }

  /* Scene 2: Dashboard */
  function sceneDashboardPlay(run) {
    setStatus("success", "Signed in");
    setProgress(2);
    showScene(sceneDash);

    later(function () {
      if (run !== currentRun) return;
      sceneChatPlay(run);
    }, 2400);
  }

  /* Scene 3: Chat page — prompt types */
  function sceneChatPlay(run) {
    setStatus("busy", "Typing…");
    setProgress(3);
    showScene(sceneChat);

    later(function () {
      if (run !== currentRun) return;
      if (userMsgEl) userMsgEl.classList.add("is-in", "is-typing");
      later(function () {
        if (run !== currentRun) return;
        typeInto(userTextEl, userText, 26, function () {
          if (run !== currentRun) return;
          if (userMsgEl) userMsgEl.classList.remove("is-typing");
          sceneAIThinking(run);
        });
      }, 260);
    }, 500);
  }

  function sceneAIThinking(run) {
    setStatus("busy", "Thinking…");
    later(function () {
      if (run !== currentRun) return;
      show(aiThinkingEl);

      later(function () {
        if (run !== currentRun) return;
        if (loadingLabel) loadingLabel.textContent = "Designing your fields…";
      }, 900);

      later(function () {
        if (run !== currentRun) return;
        hide(aiThinkingEl);
        show(aiReplyEl);
        later(function () {
          if (run !== currentRun) return;
          scenePreviewBuild(run);
        }, 850);
      }, 1700);
    }, 320);
  }

  /* Scene 4: Preview builds */
  function scenePreviewBuild(run) {
    setStatus("busy", "Preparing…");
    setProgress(4);
    showScene(scenePreview);

    later(function () { if (run === currentRun) show(formEyebrow); }, 260);
    later(function () { if (run === currentRun) show(formTitle); }, 420);
    later(function () { if (run === currentRun) show(formSub); }, 560);

    var fieldStart = 750;
    var stride = 240;
    formFields.forEach(function (field, idx) {
      var base = fieldStart + idx * stride;
      later(function () {
        if (run !== currentRun) return;
        field.classList.add("is-in");
        later(function () {
          if (run !== currentRun) return;
          field.classList.add("is-highlight");
          later(function () {
            if (run !== currentRun) return;
            field.classList.remove("is-highlight");
          }, 480);
        }, 100);
      }, base);
    });

    var afterFields = fieldStart + formFields.length * stride;

    later(function () { if (run === currentRun) show(formActions); }, afterFields);
    later(function () { if (run === currentRun) show(formNote); }, afterFields + 280);

    later(function () {
      if (run !== currentRun) return;
      showCursor();
      if (confirmBtn) moveCursorTo(confirmBtn, 40, 18);
    }, afterFields + 900);

    later(function () {
      if (run !== currentRun) return;
      if (confirmBtn) confirmBtn.classList.add("is-pressed");
      cursorPress(function () {
        if (run !== currentRun) return;
        if (confirmBtn) confirmBtn.classList.remove("is-pressed");
        if (confirmLabel) confirmLabel.textContent = "Creating…";
        hideCursor();
        sceneCreatingPlay(run);
      });
    }, afterFields + 1900);
  }

  /* Scene 5: Creating spinner */
  function sceneCreatingPlay(run) {
    setStatus("busy", "Creating…");
    setProgress(5);
    showScene(sceneCreating);

    later(function () {
      if (run !== currentRun) return;
      sceneGformShow(run);
    }, 1800);
  }

  /* Scene 6: REAL Google Form */
  function sceneGformShow(run) {
    setStatus("success", "Form created");
    setProgress(6);
    showScene(sceneGform);

    later(function () {
      if (run !== currentRun) return;
      if (gformBadge) gformBadge.classList.add("is-in");
    }, 800);

    later(function () {
      if (run !== currentRun) return;
      if (gformBadge) gformBadge.classList.remove("is-in");
      later(function () {
        if (run !== currentRun) return;
        sceneSuccessPlay(run);
      }, 480);
    }, 4200);
  }

  /* Scene 7: Success */
  function sceneSuccessPlay(run) {
    setProgress(7);
    showScene(sceneSuccess);

    later(function () { if (run === currentRun) show(successIcon); }, 140);
    later(function () { if (run === currentRun) show(successTitle); }, 380);
    later(function () { if (run === currentRun) show(successSub); }, 520);

    later(function () {
      if (run !== currentRun) return;
      if (linkField) linkField.classList.add("is-in");
      typeInto(linkTextEl, linkText, 22);
    }, 700);

    later(function () { if (run === currentRun) show(successActions); }, 1400);
    later(function () {
      if (run !== currentRun) return;
      if (demoNote) demoNote.classList.add("is-in");
      if (replayBtn) replayBtn.hidden = false;
    }, 1700);

    /* Loop */
    later(function () {
      if (run !== currentRun) return;
      out(sceneSuccess);
      later(function () {
        if (run !== currentRun) return;
        play();
      }, 520);
    }, 6800);
  }

  function startOnce() {
    if (started) return;
    started = true;
    play();
  }

  if (!("IntersectionObserver" in window)) {
    startOnce();
  } else {
    var obs = new IntersectionObserver(
      function (entries) {
        entries.forEach(function (entry) {
          if (entry.isIntersecting) {
            startOnce();
            obs.disconnect();
          }
        });
      },
      { threshold: 0.3 }
    );
    obs.observe(chatbot);
  }

  if (replayBtn) {
    replayBtn.addEventListener("click", function () {
      replayBtn.hidden = true;
      play();
    });
  }

  if (copyBtn) {
    copyBtn.addEventListener("click", function (e) {
      e.preventDefault();
      if (linkField) linkField.classList.add("is-copied");
      if (copyLabel) copyLabel.textContent = "Copied (demo)";
      later(function () {
        if (linkField) linkField.classList.remove("is-copied");
        if (copyLabel) copyLabel.textContent = "Copy Link";
      }, 1800);
    });
  }

  var openBtn = chatbot.querySelector("[data-cb-open]");
  if (openBtn) openBtn.addEventListener("click", function (e) { e.preventDefault(); });

  var backToTop = document.querySelector("[data-back-to-top]");
  if (backToTop) {
    backToTop.addEventListener("click", function (e) {
      e.preventDefault();
      window.scrollTo({ top: 0, behavior: reduceMotion ? "auto" : "smooth" });
    });
  }
})();
