export const REC_BINDING = '__dtuiRec';
export const REC_INSTALLED = '__dtuiRecInstalled';
export const REC_STOP = '__dtuiRecStop';
export const SELECTOR_DEPTH_CAP = 8;

export function buildRecorderScript(binding: string = REC_BINDING): string {
  return `(function () {
  var BINDING = ${JSON.stringify(binding)};
  if (window[${JSON.stringify(REC_INSTALLED)}]) return;
  window[${JSON.stringify(REC_INSTALLED)}] = true;
  var DEPTH = ${SELECTOR_DEPTH_CAP};

  var esc = function (s) {
    if (window.CSS && CSS.escape) return CSS.escape(s);
    return String(s).replace(/[^a-zA-Z0-9_-]/g, function (c) { return '\\\\' + c; });
  };
  var attrStr = function (s) { return String(s).replace(/["\\\\]/g, function (c) { return '\\\\' + c; }); };
  var uniqueSel = function (sel) {
    try { return document.querySelectorAll(sel).length === 1; } catch (e) { return false; }
  };
  var classesOf = function (el) {
    if (el.classList && el.classList.length) return Array.prototype.slice.call(el.classList);
    if (el.className) return String(el.className).split(/\\s+/).filter(Boolean);
    return [];
  };
  var nthOfType = function (el) {
    var p = el.parentElement;
    if (!p) return 0;
    var kids = p.children || [];
    var total = 0, mine = 0;
    for (var k = 0; k < kids.length; k++) {
      if (kids[k].tagName === el.tagName) { total++; if (kids[k] === el) mine = total; }
    }
    return total > 1 ? mine : 0;
  };
  var pathFor = function (el) {
    var parts = [];
    var cur = el;
    var depth = 0;
    while (cur && cur.nodeType === 1 && depth < DEPTH) {
      if (cur.id) {
        var idsel = '#' + esc(cur.id);
        if (uniqueSel(idsel)) { parts.unshift(idsel); return parts.join(' > '); }
      }
      var tag = cur.tagName.toLowerCase();
      var n = nthOfType(cur);
      parts.unshift(n ? tag + ':nth-of-type(' + n + ')' : tag);
      cur = cur.parentElement;
      depth++;
    }
    return parts.join(' > ');
  };
  var selectorFor = function (el) {
    if (!el || el.nodeType !== 1) return null;
    if (el.id) { var s = '#' + esc(el.id); if (uniqueSel(s)) return s; }
    var testid = el.getAttribute && el.getAttribute('data-testid');
    if (testid) { var s2 = '[data-testid="' + attrStr(testid) + '"]'; if (uniqueSel(s2)) return s2; }
    var tag = el.tagName.toLowerCase();
    var name = el.getAttribute && el.getAttribute('name');
    if (name) { var s3 = tag + '[name="' + attrStr(name) + '"]'; if (uniqueSel(s3)) return s3; }
    var classes = classesOf(el);
    if (classes.length) {
      var s4 = tag + classes.map(function (c) { return '.' + esc(c); }).join('');
      if (uniqueSel(s4)) return s4;
    }
    return pathFor(el);
  };

  var dirty = new WeakMap();
  var emit = function (step) { try { window[BINDING](JSON.stringify(step)); } catch (e) {} };
  var targetOf = function (ev) {
    var t = ev.composedPath ? ev.composedPath()[0] : ev.target;
    if (!t) t = ev.target;
    var root = t && t.getRootNode ? t.getRootNode() : null;
    if (root && root.host) t = root.host;
    return t;
  };
  var isTextField = function (el) {
    if (el.tagName === 'TEXTAREA') return true;
    if (el.tagName !== 'INPUT') return false;
    var type = String(el.type || 'text').toLowerCase();
    return ['button', 'submit', 'reset', 'checkbox', 'radio', 'file', 'image', 'range', 'color'].indexOf(type) < 0;
  };
  var isPassword = function (el) {
    return el.tagName === 'INPUT' && String(el.type || '').toLowerCase() === 'password';
  };
  var valueOf = function (el) { return el.value == null ? '' : String(el.value); };
  var flush = function (el) {
    if (!el || !dirty.has(el)) return;
    dirty['delete'](el);
    var sel = selectorFor(el);
    if (!sel) return;
    if (isPassword(el)) emit({ kind: 'input', selector: sel, redacted: true });
    else emit({ kind: 'input', selector: sel, value: valueOf(el) });
  };

  var onInput = function (ev) {
    var t = targetOf(ev);
    if (t && t.nodeType === 1 && isTextField(t)) dirty.set(t, true);
  };
  var onChange = function (ev) {
    var t = targetOf(ev);
    if (!t || t.nodeType !== 1) return;
    if (t.tagName === 'SELECT') {
      var s = selectorFor(t);
      if (s) emit({ kind: 'select', selector: s, value: valueOf(t) });
      return;
    }
    flush(t);
  };
  var onKeyDown = function (ev) {
    var key = ev.key;
    if (key !== 'Enter' && key !== 'Escape' && key !== 'Tab') return;
    var ae = document.activeElement;
    if (key === 'Enter') flush(ae && ae.nodeType === 1 ? ae : targetOf(ev));
    var sel = ae && ae.nodeType === 1 ? selectorFor(ae) : null;
    emit({ kind: 'key', selector: sel, key: key });
  };
  var onClick = function (ev) {
    var t = targetOf(ev);
    if (!t || t.nodeType !== 1) return;
    var sel = selectorFor(t);
    if (!sel) return;
    var step = { kind: 'click', selector: sel };
    if (typeof ev.clientX === 'number') step.alt = { x: Math.round(ev.clientX), y: Math.round(ev.clientY) };
    emit(step);
  };

  window.addEventListener('click', onClick, true);
  window.addEventListener('input', onInput, true);
  window.addEventListener('change', onChange, true);
  window.addEventListener('keydown', onKeyDown, true);
  window[${JSON.stringify(REC_STOP)}] = function () {
    window.removeEventListener('click', onClick, true);
    window.removeEventListener('input', onInput, true);
    window.removeEventListener('change', onChange, true);
    window.removeEventListener('keydown', onKeyDown, true);
    window[${JSON.stringify(REC_INSTALLED)}] = false;
    try { delete window[${JSON.stringify(REC_STOP)}]; } catch (e) { window[${JSON.stringify(REC_STOP)}] = undefined; }
  };
})()`;
}

export function buildRecorderStopScript(): string {
  return `(function () { var f = window[${JSON.stringify(REC_STOP)}]; if (typeof f === 'function') f(); })()`;
}
