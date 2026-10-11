/* ═══════════════════════════════════════════════════════════════
   AI Forms Agent — landing interactions
   Hero chatbot: prompt → AI reply → preview → confirm →
                 REAL Google Form preview → link card → loop
   Respects prefers-reduced-motion.
   ═══════════════════════════════════════════════════════════════ */

(function () {
  "use strict";

  var reduceMotion = window.matchMedia(
    "(prefers-reduced-motion: reduce)"
  ).matches;

  /* ─── Sticky nav ─── */
  var nav = document.querySelector("[data-nav]");
  if (nav) {
    var onScroll = function () {
      nav.setAttribute("data-scrolled", window.scrollY > 8 ? "true" : "false");
    };
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
  }

  /* ─── Mobile nav ─── */
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

  /* ─── Reveal on scroll ─── */
  var reveals = Array.prototype.slice.call(document.querySelectorAll(".reveal"));
  if (reveals.length) {
    if (reduceMotion || !("IntersectionObserver" in window)) {
      reveals.forEach(function (el) { el.classList.add("is-in"); });
    } else {
      var revealObs = new IntersectionObserver(
        function (entries) {
          var visible = entries
            .filter(function (e) { return e.isIntersecting; })
            .map(function (e) { return e.target; });
          visible.forEach(function (el, i) {
            setTimeout(function () {
              el.classList.add("is-in");
              revealObs.unobserve(el);
            }, i * 70);
          });
        },
        { rootMargin: "0px 0px -10% 0px", threshold: 0.1 }
      );
      reveals.forEach(function (el) { revealObs.observe(el); });
    }
  }

  /* ═══════════════════════════════════════════════════════════
     CHATBOT
     ═══════════════════════════════════════════════════════════ */

  var chatbot = document.querySelector("[data-chatbot]");
  if (!chatbot) return;

  var chat = chatbot.querySelector("[data-cb-chat]");
  var formScene = chatbot.querySelector("[data-cb-form]");
  var creatingScene = chatbot.querySelector("[data-cb-creating]");
  var gformScene = chatbot.querySelector("[data-cb-gform]");
  var gformBadge = chatbot.querySelector("[data-cb-gform-badge]");
  var successScene = chatbot.querySelector("[data-cb-success]");
  var statusEl = chatbot.querySelector("[data-cb-status]");
  var statusTextEl = chatbot.querySelector("[data-cb-status-text]");
  var userMsgEl = chatbot.querySelector('[data-scene="user-msg"]');
  var userTextEl = chatbot.querySelector("[data-type-text]");
  var userText = userTextEl ? userTextEl.getAttribute("data-text") || "" : "";
  var loadingLabel = chatbot.querySelector("[data-cb-loading-label]");
  var aiThinkingEl = chatbot.querySelector('[data-scene="ai-thinking"]');
  var aiReplyEl = chatbot.querySelector('[data-scene="ai-reply"]');
  var formEyebrow = chatbot.querySelector('[data-scene="form-eyebrow"]');
  var formTitle = chatbot.querySelector('[data-scene="form-title"]');
  var formSub = chatbot.querySelector('[data-scene="form-sub"]');
  var formFields = Array.prototype.slice.call(chatbot.querySelectorAll(".cb-field"));
  var formActions = chatbot.querySelector('[data-scene="form-actions"]');
  var formNote = chatbot.querySelector('[data-scene="form-note"]');
  var confirmBtn = chatbot.querySelector("[data-cb-confirm]");
  var confirmLabel = chatbot.querySelector("[data-cb-confirm-label]");
  var cursor = chatbot.querySelector(".cb-cursor");
  var successIcon = chatbot.querySelector(".cb-success-icon");
  var successTitle = chatbot.querySelector(".cb-success-title");
  var successSub = chatbot.querySelector(".cb-success-sub");
  var successActions = chatbot.querySelector(".cb-success-actions");
  var linkField = chatbot.querySelector('[data-scene="link"]');
  var linkTextEl = chatbot.querySelector("[data-link-text]");
  var linkText = linkTextEl ? linkTextEl.getAttribute("data-text") || "" : "";
  var demoNote = chatbot.querySelector(".cb-demo-note");
  var copyBtn = chatbot.querySelector("[data-cb-copy]");
  var copyLabel = chatbot.querySelector("[data-cb-copy-label]");
  var replayBtn = chatbot.querySelector("[data-cb-replay]");
  var progressSegs = Array.prototype.slice.call(chatbot.querySelectorAll("[data-cb-seg]"));

  var timers = [];
  var currentRun = 0;
  var hasPlayedOnce = false;

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

  function reset() {
    clearTimers();
    currentRun++;

    if (userTextEl) userTextEl.textContent = "";
    if (userMsgEl) userMsgEl.classList.remove("is-in", "is-typing");
    if (aiThinkingEl) aiThinkingEl.classList.remove("is-in");
    if (aiReplyEl) aiReplyEl.classList.remove("is-in");
    if (loadingLabel) loadingLabel.textContent = "Preparing your questions…";

    if (formScene) {
      formScene.classList.remove("is-in", "is-out");
      formScene.style.display = "";
    }
    if (formEyebrow) formEyebrow.classList.remove("is-in");
    if (formTitle) formTitle.classList.remove("is-in");
    if (formSub) formSub.classList.remove("is-in");
    formFields.forEach(function (f) { f.classList.remove("is-in", "is-highlight"); });
    if (formActions) formActions.classList.remove("is-in");
    if (formNote) formNote.classList.remove("is-in");

    if (confirmBtn) confirmBtn.classList.remove("is-pressed");
    if (confirmLabel) confirmLabel.textContent = "Confirm & Create Form";

    if (cursor) {
      cursor.classList.remove("is-visible", "is-moving", "is-at-target", "is-clicking");
      cursor.style.transform = "";
    }

    if (creatingScene) {
      creatingScene.classList.remove("is-in", "is-out");
      creatingScene.style.display = "";
    }

    if (gformScene) {
      gformScene.classList.remove("is-in", "is-out");
      gformScene.style.display = "";
    }
    if (gformBadge) gformBadge.classList.remove("is-in");

    if (successScene) {
      successScene.classList.remove("is-in", "is-out");
      successScene.style.display = "";
    }
    if (successIcon) successIcon.classList.remove("is-in");
    if (successTitle) successTitle.classList.remove("is-in");
    if (successSub) successSub.classList.remove("is-in");
    if (successActions) successActions.classList.remove("is-in");
    if (linkField) linkField.classList.remove("is-in", "is-copied");
    if (linkTextEl) linkTextEl.textContent = "";
    if (demoNote) demoNote.classList.remove("is-in");
    if (copyLabel) copyLabel.textContent = "Copy Link";

    if (chat) chat.style.display = "";

    setStatus("idle", "Ready");
    setProgress(0);
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

  function play() {
    reset();
    var run = currentRun;

    /* Reduced motion → final state instantly */
    if (reduceMotion) {
      if (userTextEl) userTextEl.textContent = userText;
      if (userMsgEl) userMsgEl.classList.add("is-in");
      if (aiReplyEl) aiReplyEl.classList.add("is-in");
      if (chat) chat.style.display = "none";
      if (gformScene) gformScene.classList.add("is-in");
      if (gformBadge) gformBadge.classList.add("is-in");
      if (successScene) successScene.classList.add("is-in");
      if (successIcon) successIcon.classList.add("is-in");
      if (successTitle) successTitle.classList.add("is-in");
      if (successSub) successSub.classList.add("is-in");
      if (linkField) linkField.classList.add("is-in");
      if (linkTextEl) linkTextEl.textContent = linkText;
      if (successActions) successActions.classList.add("is-in");
      if (demoNote) demoNote.classList.add("is-in");
      setStatus("success", "Done");
      setProgress(4);
      if (replayBtn) replayBtn.hidden = false;
      return;
    }

    /* ─── SCENE 1: prompt typing ─── */
    setStatus("busy", "Typing…");
    setProgress(0);

    later(function () {
      if (run !== currentRun) return;
      if (userMsgEl) userMsgEl.classList.add("is-in", "is-typing");
      later(function () {
        if (run !== currentRun) return;
        typeInto(userTextEl, userText, 26, function () {
          if (run !== currentRun) return;
          if (userMsgEl) userMsgEl.classList.remove("is-typing");
          sceneAI(run);
        });
      }, 240);
    }, 250);
  }

  /* ─── SCENE 2: AI thinking + reply ─── */
  function sceneAI(run) {
    setStatus("busy", "Thinking…");
    setProgress(1);

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
          scenePreview(run);
        }, 850);
      }, 1700);
    }, 350);
  }

  /* ─── SCENE 3: pre-confirm preview ─── */
  function scenePreview(run) {
    setStatus("busy", "Preparing…");
    setProgress(2);

    later(function () {
      if (run !== currentRun) return;
      if (chat) chat.style.display = "none";
      show(formScene);

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
        sceneConfirm(run);
      }, afterFields + 1300);
    }, 400);
  }

  /* ─── SCENE 4: cursor click ─── */
  function sceneConfirm(run) {
    setStatus("busy", "Ready to confirm");

    later(function () {
      if (run !== currentRun) return;
      if (!cursor) { doConfirm(run); return; }

      cursor.classList.add("is-visible");
      cursor.style.transform = "translate(70px, -40px) scale(1)";

      later(function () {
        if (run !== currentRun) return;
        cursor.classList.add("is-moving", "is-at-target");
        cursor.style.transform = "translate(0, 0) scale(1)";

        later(function () {
          if (run !== currentRun) return;
          cursor.classList.add("is-clicking");
          doConfirm(run);
        }, 700);
      }, 60);
    }, 200);
  }

  function doConfirm(run) {
    if (run !== currentRun) return;

    if (confirmBtn) confirmBtn.classList.add("is-pressed");
    if (confirmLabel) confirmLabel.textContent = "Creating…";

    later(function () {
      if (run !== currentRun) return;
      if (confirmBtn) confirmBtn.classList.remove("is-pressed");

      setStatus("busy", "Creating…");
      setProgress(3);
      if (formScene) formScene.classList.add("is-out");

      later(function () {
        if (run !== currentRun) return;
        if (formScene) formScene.style.display = "none";
        show(creatingScene);

        later(function () {
          if (run !== currentRun) return;
          if (creatingScene) {
            creatingScene.classList.remove("is-in");
            creatingScene.classList.add("is-out");
          }

          later(function () {
            if (run !== currentRun) return;
            if (creatingScene) creatingScene.style.display = "none";
            sceneGform(run);
          }, 380);
        }, 1800);
      }, 380);
    }, 380);
  }

  /* ─── SCENE 4b: real Google Form preview ─── */
  function sceneGform(run) {
    setStatus("success", "Form created");
    if (gformScene) gformScene.classList.add("is-in");

    // After the form has settled, slide in the "Google Form created" badge
    later(function () {
      if (run !== currentRun) return;
      if (gformBadge) gformBadge.classList.add("is-in");
    }, 800);

    // Hold on the Google Form preview so people can actually read it
    later(function () {
      if (run !== currentRun) return;
      if (gformScene) {
        gformScene.classList.remove("is-in");
        gformScene.classList.add("is-out");
      }
      if (gformBadge) gformBadge.classList.remove("is-in");

      later(function () {
        if (run !== currentRun) return;
        if (gformScene) gformScene.style.display = "none";
        sceneSuccess(run);
      }, 480);
    }, 4200);
  }

  /* ─── SCENE 5: success / link card ─── */
  function sceneSuccess(run) {
    setProgress(4);
    show(successScene);

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

    // Loop
    later(function () {
      if (run !== currentRun) return;
      if (successScene) successScene.classList.add("is-out");
      later(function () {
        if (run !== currentRun) return;
        play();
      }, 520);
    }, 6800);
  }

  /* ─── Start once when visible ─── */
  function startOnce() {
    if (hasPlayedOnce) return;
    hasPlayedOnce = true;
    play();
  }

  if (!("IntersectionObserver" in window)) {
    startOnce();
  } else {
    var chatbotObs = new IntersectionObserver(
      function (entries) {
        entries.forEach(function (entry) {
          if (entry.isIntersecting) {
            startOnce();
            chatbotObs.disconnect();
          }
        });
      },
      { threshold: 0.3 }
    );
    chatbotObs.observe(chatbot);
  }

  /* ─── Replay ─── */
  if (replayBtn) {
    replayBtn.addEventListener("click", function () {
      replayBtn.hidden = true;
      play();
    });
  }

  /* ─── Copy (demo, never touches the real clipboard) ─── */
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

  /* ─── Open Form — inert in the demo ─── */
  var openBtn = chatbot.querySelector("[data-cb-open]");
  if (openBtn) {
    openBtn.addEventListener("click", function (e) { e.preventDefault(); });
  }

  /* ─── Back to top ─── */
  var backToTop = document.querySelector("[data-back-to-top]");
  if (backToTop) {
    backToTop.addEventListener("click", function (e) {
      e.preventDefault();
      window.scrollTo({ top: 0, behavior: reduceMotion ? "auto" : "smooth" });
    });
  }
})();