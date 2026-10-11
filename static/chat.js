(function () {
  var root = document.getElementById('chat');
  if (!root) return;
  var box = document.getElementById('messages');
  var form = document.getElementById('composer');
  var text = document.getElementById('text');
  var send = document.getElementById('send');
  var file = document.getElementById('file');
  var statusEl = document.getElementById('status');
  var previewBtn = document.getElementById('preview-btn');
  var csrf = document.querySelector('meta[name=csrf-token]').content;
  var MAX_BYTES = 10 * 1024 * 1024;

  function bubble(role, content, extra) {
    var wrap = document.createElement('div');
    wrap.className = 'msg ' + role + (extra ? ' ' + extra : '');
    var b = document.createElement('div');
    b.className = 'bubble';
    b.textContent = content; // textContent: model/user text can never inject HTML
    wrap.appendChild(b);
    box.appendChild(wrap);
    box.scrollTop = box.scrollHeight;
    return wrap;
  }

  function setBusy(busy) {
    send.disabled = busy;
    file.disabled = busy;
    statusEl.textContent = busy ? 'The assistant is working...' : '';
  }

  function handle(promise, typing) {
    return promise.then(function (resp) {
      return resp.json().catch(function () { return {}; }).then(function (data) {
        typing.remove();
        if (!resp.ok) {
          bubble('error', data.error || 'Something went wrong. Please try again.');
          return;
        }
        bubble('assistant', data.reply);
        if (data.warnings && data.warnings.length) {
          bubble('assistant', 'Please check in the preview: ' + data.warnings.join(' '));
        }
        if (data.has_spec) previewBtn.classList.remove('d-none');
      });
    }).catch(function () {
      typing.remove();
      bubble('error', 'Network problem. Check your connection and try again.');
    }).then(function () { setBusy(false); });
  }

  function headers(json) {
    var h = { 'X-CSRFToken': csrf, 'X-Requested-With': 'fetch' };
    if (json) h['Content-Type'] = 'application/json';
    return h;
  }

  form.addEventListener('submit', function (ev) {
    ev.preventDefault();
    var value = text.value.trim();
    if (!value) return;
    bubble('user', value);
    text.value = '';
    setBusy(true);
    var typing = bubble('assistant', '', 'typing');
    handle(fetch(root.dataset.messageUrl, {
      method: 'POST', headers: headers(true), body: JSON.stringify({ text: value })
    }), typing);
  });

  text.addEventListener('keydown', function (ev) {
    if (ev.key === 'Enter' && (ev.ctrlKey || ev.metaKey)) form.requestSubmit();
  });

  file.addEventListener('change', function () {
    var f = file.files[0];
    if (!f) return;
    if (f.size > MAX_BYTES) {
      bubble('error', 'That file is larger than 10 MB.');
      file.value = '';
      return;
    }
    bubble('user', 'Uploading: ' + f.name);
    setBusy(true);
    var typing = bubble('assistant', '', 'typing');
    var data = new FormData();
    data.append('file', f);
    handle(fetch(root.dataset.uploadUrl, { method: 'POST', headers: headers(false), body: data }), typing);
    file.value = '';
  });
})();
