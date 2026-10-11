// Form preview + editor. All user text is placed with textContent/value, never innerHTML.
(function () {
  var root = document.getElementById('editor');
  if (!root) return;
  var spec = JSON.parse(document.getElementById('spec-data').textContent);
  var errBox = document.getElementById('errors');
  var csrf = document.querySelector('meta[name=csrf-token]').content;
  var createForm = document.getElementById('create-form');
  var uploadNote = document.getElementById('upload-note');
  var destGoogle = document.getElementById('dest-google');
  var destCustom = document.getElementById('dest-custom');
  var confirmBtn = document.getElementById('confirm-btn');

  var TYPES = [
    ['multiple_choice', 'Multiple choice'], ['checkbox', 'Checkboxes'], ['dropdown', 'Dropdown'],
    ['true_false', 'True / False'], ['short_answer', 'Short answer'], ['paragraph', 'Paragraph'],
    ['email', 'Email'], ['file_upload', 'File upload (custom form only)']
  ];
  var LABELS = {};
  TYPES.forEach(function (t) { LABELS[t[0]] = t[1]; });
  var CHOICE = { multiple_choice: 1, checkbox: 1, dropdown: 1, true_false: 1 };
  var saveTimer = null;

  function el(tag, props, kids) {
    var node = document.createElement(tag);
    Object.keys(props || {}).forEach(function (k) {
      if (k === 'class') node.className = props[k];
      else if (k === 'text') node.textContent = props[k];
      else if (k === 'value') node.value = props[k];
      else if (k.slice(0, 2) === 'on') node.addEventListener(k.slice(2), props[k]);
      else if (props[k] === true) node.setAttribute(k, '');
      else if (props[k] !== false && props[k] != null) node.setAttribute(k, props[k]);
    });
    (kids || []).forEach(function (c) { node.appendChild(c); });
    return node;
  }

  function hasUpload() {
    return spec.questions.some(function (q) { return q.type === 'file_upload'; });
  }

  function syncDestination() {
    var upload = hasUpload();
    uploadNote.classList.toggle('d-none', !upload);
    destGoogle.disabled = upload;
    if (upload) destCustom.checked = true;
  }

  function showErrors(list) {
    errBox.textContent = '';
    if (!list || !list.length) { errBox.classList.add('d-none'); return; }
    var ul = el('ul', { class: 'mb-0' });
    list.forEach(function (e) { ul.appendChild(el('li', { text: e })); });
    errBox.appendChild(ul);
    errBox.classList.remove('d-none');
  }

  function save() {
    return fetch(root.dataset.saveUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-CSRFToken': csrf, 'X-Requested-With': 'fetch' },
      body: JSON.stringify(spec)
    }).then(function (r) { return r.json().then(function (d) { return { ok: r.ok, data: d }; }); })
      .then(function (res) {
        if (!res.ok) { showErrors([res.data.error || 'Could not save your changes.']); return false; }
        spec = res.data.spec;
        showErrors(res.data.errors);
        return res.data.errors.length === 0;
      }).catch(function () { showErrors(['Network problem while saving.']); return false; });
  }

  function autosave() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(save, 900);
  }

  function move(i, d) {
    var j = i + d;
    if (j < 0 || j >= spec.questions.length) return;
    var t = spec.questions[i]; spec.questions[i] = spec.questions[j]; spec.questions[j] = t;
    render(); autosave();
  }

  function setType(q, type) {
    q.type = type;
    if (type === 'true_false') { q.options = ['True', 'False']; }
    else if (CHOICE[type]) { if (q.options.length < 2) q.options = ['Option 1', 'Option 2']; }
    else { q.options = []; }
    q.correct = (q.correct || []).filter(function (c) { return q.options.indexOf(c) >= 0; });
    if (type !== 'checkbox' && q.correct.length > 1) q.correct = q.correct.slice(0, 1);
  }

  function optionRows(q) {
    var box = el('div');
    q.options.forEach(function (opt, oi) {
      var multi = q.type === 'checkbox';
      var mark = el('input', {
        type: multi ? 'checkbox' : 'radio', name: 'correct-' + q._id, class: 'form-check-input',
        title: 'Correct answer', 'aria-label': 'Mark as correct',
        onchange: function (ev) {
          var v = q.options[oi];
          if (multi) {
            var at = q.correct.indexOf(v);
            if (ev.target.checked && at < 0) q.correct.push(v);
            if (!ev.target.checked && at >= 0) q.correct.splice(at, 1);
          } else { q.correct = [v]; }
          autosave();
        }
      });
      mark.checked = q.correct.indexOf(opt) >= 0;
      if (!spec.is_quiz) mark.classList.add('d-none');
      var input = el('input', {
        type: 'text', class: 'form-control form-control-sm', value: opt, maxlength: 300,
        'aria-label': 'Option ' + (oi + 1),
        readonly: q.type === 'true_false',
        oninput: function (ev) {
          var old = q.options[oi], now = ev.target.value;
          var at = q.correct.indexOf(old);
          if (at >= 0) q.correct[at] = now;
          q.options[oi] = now;
          autosave();
        }
      });
      var row = el('div', { class: 'opt-row' }, [mark, input]);
      if (q.type !== 'true_false') {
        row.appendChild(el('button', {
          type: 'button', class: 'btn btn-sm btn-outline-danger', text: 'x', title: 'Remove option',
          onclick: function () {
            var removed = q.options.splice(oi, 1)[0];
            q.correct = q.correct.filter(function (c) { return c !== removed; });
            render(); autosave();
          }
        }));
      }
      box.appendChild(row);
    });
    if (q.type !== 'true_false') {
      box.appendChild(el('button', {
        type: 'button', class: 'btn btn-sm btn-outline-secondary', text: 'Add option',
        onclick: function () { q.options.push(''); render(); }
      }));
    }
    return box;
  }

  function questionCard(q, i) {
    q._id = q._id || ('q' + i + '-' + Math.random().toString(36).slice(2, 7));
    var header = el('div', { class: 'd-flex flex-wrap align-items-center gap-2 mb-2' }, [
      el('strong', { text: 'Question ' + (i + 1) }),
      el('span', { class: 'badge badge-type', text: LABELS[q.type] || q.type }),
      q.required ? el('span', { class: 'text-danger small', text: '* required' }) : el('span', { class: 'text-secondary small', text: 'optional' }),
      el('span', { class: 'ms-auto d-inline-flex gap-1' }, [
        el('button', { type: 'button', class: 'btn btn-sm btn-outline-secondary', text: 'Up', onclick: function () { move(i, -1); } }),
        el('button', { type: 'button', class: 'btn btn-sm btn-outline-secondary', text: 'Down', onclick: function () { move(i, 1); } }),
        el('button', {
          type: 'button', class: 'btn btn-sm btn-outline-danger', text: 'Delete',
          onclick: function () { spec.questions.splice(i, 1); render(); autosave(); }
        })
      ])
    ]);

    var textArea = el('textarea', {
      class: 'form-control mb-2', rows: 2, maxlength: 1000, value: q.text, 'aria-label': 'Question text',
      oninput: function (ev) { q.text = ev.target.value; autosave(); }
    });
    var typeSel = el('select', {
      class: 'form-select form-select-sm', 'aria-label': 'Question type',
      onchange: function (ev) { setType(q, ev.target.value); render(); autosave(); }
    }, TYPES.map(function (t) {
      var o = el('option', { value: t[0], text: t[1] });
      if (t[0] === q.type) o.selected = true;
      return o;
    }));
    var req = el('input', {
      type: 'checkbox', class: 'form-check-input', id: 'req-' + q._id,
      onchange: function (ev) { q.required = ev.target.checked; render(); autosave(); }
    });
    req.checked = !!q.required;
    var controls = el('div', { class: 'd-flex flex-wrap gap-3 align-items-center mb-2' }, [
      el('div', { style: 'min-width: 220px' }, [typeSel]),
      el('div', { class: 'form-check m-0' }, [req, el('label', { class: 'form-check-label', for: 'req-' + q._id, text: 'Required' })])
    ]);
    if (spec.is_quiz && CHOICE[q.type]) {
      controls.appendChild(el('label', { class: 'small text-secondary', text: 'Points ' }, [
        el('input', {
          type: 'number', min: 0, max: 100, value: q.points, class: 'form-control form-control-sm d-inline-block', style: 'width: 80px',
          oninput: function (ev) { q.points = parseInt(ev.target.value || '0', 10) || 0; autosave(); }
        })
      ]));
    }

    var body = [header, textArea, controls];
    if (CHOICE[q.type]) {
      body.push(optionRows(q));
      if (spec.is_quiz) body.push(el('div', { class: 'form-text', text: q.type === 'checkbox' ? 'Tick every correct answer.' : 'Select the correct answer.' }));
    } else if (q.type === 'file_upload') {
      body.push(el('div', { class: 'form-text', text: 'Respondents will upload a file (up to 10 MB). Available in custom forms only.' }));
    }
    return el('div', { class: 'card q-card mb-3' }, [el('div', { class: 'card-body' }, body)]);
  }

  function render() {
    root.textContent = '';
    var title = el('input', {
      class: 'form-control form-control-lg mb-2', value: spec.title, maxlength: 200, placeholder: 'Form title',
      'aria-label': 'Form title', oninput: function (ev) { spec.title = ev.target.value; autosave(); }
    });
    var desc = el('textarea', {
      class: 'form-control mb-2', rows: 2, maxlength: 2000, placeholder: 'Description (optional)', value: spec.description || '',
      'aria-label': 'Form description', oninput: function (ev) { spec.description = ev.target.value; autosave(); }
    });
    var quiz = el('input', {
      type: 'checkbox', class: 'form-check-input', id: 'quiz',
      onchange: function (ev) { spec.is_quiz = ev.target.checked; render(); autosave(); }
    });
    quiz.checked = !!spec.is_quiz;
    root.appendChild(el('div', { class: 'card mb-3' }, [el('div', { class: 'card-body' }, [
      title, desc,
      el('div', { class: 'form-check' }, [quiz, el('label', { class: 'form-check-label', for: 'quiz', text: 'This is a quiz (mark correct answers and points)' })])
    ])]));

    spec.questions.forEach(function (q, i) { root.appendChild(questionCard(q, i)); });

    root.appendChild(el('button', {
      type: 'button', class: 'btn btn-outline-primary', text: 'Add question',
      onclick: function () {
        spec.questions.push({ type: 'multiple_choice', text: '', options: ['Option 1', 'Option 2'], required: true, correct: [], points: 1 });
        render(); autosave();
      }
    }));
    syncDestination();
  }

  createForm.addEventListener('submit', function (ev) {
    ev.preventDefault();
    clearTimeout(saveTimer);
    confirmBtn.disabled = true;
    save().then(function (ok) {
      if (ok) { createForm.submit(); }
      else { confirmBtn.disabled = false; window.scrollTo({ top: 0, behavior: 'smooth' }); }
    });
  });

  render();
})();
