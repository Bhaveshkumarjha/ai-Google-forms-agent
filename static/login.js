/* Login page: welcome animation -> product ads card -> loop */
(function () {
  "use strict";
  var root = document.querySelector("[data-showcase]");
  if (!root) return;

  var stage = root.querySelector("[data-stage]");
  var welcome = root.querySelector('[data-panel="welcome"]');
  var ads = root.querySelector('[data-panel="ads"]');
  var slides = Array.prototype.slice.call(root.querySelectorAll("[data-slide]"));
  var dots = Array.prototype.slice.call(root.querySelectorAll("[data-dot]"));
  var bar = root.querySelector("[data-bar]");
  var heading = root.querySelector("[data-type]");

  var WELCOME_MS = 4500;   // how long the welcome text stays (ms)
  var SLIDE_MS = 6000;     // how long each product slide stays (ms)

  var reduce = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  var current = 0, phase = "welcome", timer = null;

  /* Split the heading into animated characters (accent part keeps a gradient colour) */
  function buildHeading() {
    if (!heading) return;
    var label = heading.textContent.replace(/\s+/g, " ").trim();
    heading.setAttribute("aria-label", label);
    var stops = [[165, 180, 255], [196, 181, 253], [245, 184, 240]];
    function mix(t) {
      var seg = t < 0.5 ? 0 : 1, lt = t < 0.5 ? t * 2 : (t - 0.5) * 2;
      var a = stops[seg], b = stops[seg + 1];
      return "rgb(" + [0, 1, 2].map(function (i) { return Math.round(a[i] + (b[i] - a[i]) * lt); }).join(",") + ")";
    }
    var out = document.createDocumentFragment(), n = 0;
    Array.prototype.slice.call(heading.childNodes).forEach(function (node) {
      var accent = node.nodeType === 1;
      var text = node.textContent;
      var wrap = accent ? document.createElement("span") : null;
      var target = accent ? wrap : out;
      var words = text.split(/(\s+)/);
      words.forEach(function (w) {
        if (!w) return;
        if (/^\s+$/.test(w)) { target.appendChild(document.createTextNode(" ")); return; }
        var word = document.createElement("span");
        word.className = "lg-word";
        word.setAttribute("aria-hidden", "true");
        for (var i = 0; i < w.length; i++) {
          var ch = document.createElement("span");
          ch.className = "lg-ch";
          ch.textContent = w.charAt(i);
          ch.style.animationDelay = (0.25 + n * 0.035).toFixed(3) + "s";
          if (accent) ch.style.color = mix(Math.min(1, i / Math.max(1, w.length - 1)) * 0.5 + (n / 40));
          word.appendChild(ch);
          n++;
        }
        target.appendChild(word);
      });
      if (accent) out.appendChild(wrap);
    });
    heading.textContent = "";
    heading.appendChild(out);
  }

  function replayWelcome() {
    welcome.classList.remove("is-playing");
    void welcome.offsetWidth;                // restart CSS animations
    welcome.classList.add("is-playing");
  }

  function restartBar() {
    if (!bar) return;
    bar.classList.remove("run");
    void bar.offsetWidth;
    if (!reduce) bar.classList.add("run");
  }

  function setInert(el, on) { if (on) el.setAttribute("inert", ""); else el.removeAttribute("inert"); }

  function showSlide(n) {
    current = (n + slides.length) % slides.length;
    slides.forEach(function (s, k) {
      var on = k === current;
      s.classList.toggle("is-active", on);
      s.setAttribute("aria-hidden", on ? "false" : "true");
      setInert(s, !on);
    });
    dots.forEach(function (d, k) {
      d.classList.toggle("is-active", k === current);
      if (k === current) d.setAttribute("aria-current", "true"); else d.removeAttribute("aria-current");
    });
    restartBar();
  }

  function setPhase(name) {
    phase = name;
    var isW = name === "welcome";
    welcome.classList.toggle("is-on", isW);
    ads.classList.toggle("is-on", !isW);
    welcome.setAttribute("aria-hidden", isW ? "false" : "true");
    ads.setAttribute("aria-hidden", isW ? "true" : "false");
    setInert(welcome, !isW);
    setInert(ads, isW);
    if (isW) { replayWelcome(); if (bar) bar.classList.remove("run"); }
    else { showSlide(0); }
  }

  function stop() { if (timer) { clearTimeout(timer); timer = null; } if (bar) bar.classList.remove("run"); }

  function schedule() {
    stop();
    if (reduce) return;
    if (phase === "welcome") {
      timer = setTimeout(function () { setPhase("ads"); schedule(); }, WELCOME_MS);
    } else {
      restartBar();
      timer = setTimeout(function () {
        if (current >= slides.length - 1) setPhase("welcome"); else showSlide(current + 1);
        schedule();
      }, SLIDE_MS);
    }
  }

  dots.forEach(function (d, k) { d.addEventListener("click", function () { showSlide(k); schedule(); }); });
  var prev = root.querySelector("[data-prev]"), next = root.querySelector("[data-next]");
  if (prev) prev.addEventListener("click", function () { showSlide(current - 1); schedule(); });
  if (next) next.addEventListener("click", function () { showSlide(current + 1); schedule(); });

  root.addEventListener("mouseenter", stop);
  root.addEventListener("mouseleave", schedule);
  root.addEventListener("focusin", stop);
  root.addEventListener("focusout", schedule);
  document.addEventListener("visibilitychange", function () { if (document.hidden) stop(); else schedule(); });

  buildHeading();

  if (reduce) {
    /* No motion: show welcome text and the ads card together, no loop */
    stage.classList.add("is-static");
    return;
  }
  stage.classList.add("is-js");
  setPhase("welcome");
  schedule();
})();
