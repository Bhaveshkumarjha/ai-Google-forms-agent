// Small helpers shared by every page (no inline scripts, so the CSP can stay strict).
(function () {
  function copy(text, btn) {
    var done = function () {
      if (!btn) return;
      var old = btn.textContent;
      btn.textContent = 'Copied';
      setTimeout(function () { btn.textContent = old; }, 1500);
    };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(done, function () { window.prompt('Copy this link:', text); });
    } else {
      window.prompt('Copy this link:', text);
    }
  }

  document.addEventListener('click', function (ev) {
    var btn = ev.target.closest('[data-copy],[data-copy-text]');
    if (!btn) return;
    var text = btn.getAttribute('data-copy-text');
    if (!text) {
      var input = document.querySelector(btn.getAttribute('data-copy'));
      text = input ? input.value : '';
    }
    if (text) copy(text, btn);
  });

  document.addEventListener('submit', function (ev) {
    var msg = ev.target.getAttribute && ev.target.getAttribute('data-confirm');
    if (msg && !window.confirm(msg)) ev.preventDefault();
  });
})();
