import { test, expect } from 'vitest';
import { displayLineFor, prettyPrint } from '../src/tui/lib/pretty-print.js';

test('reformats minified statements with newlines and indentation', () => {
  const res = prettyPrint('function a(){return 1;}var b=2;');
  expect(res.lines).toEqual(['function a(){', '  return 1;', '}', 'var b=2;']);
  expect(res.displayToOriginal).toEqual([0, 0, 0, 0]);
});

test('a regex containing braces and a slash in a class does not break lines', () => {
  const res = prettyPrint('var r=/a{2}[/]/g;if(r){x=1;}');
  expect(res.lines).toEqual(['var r=/a{2}[/]/g;', 'if(r){', '  x=1;', '}']);
});

test('template literals with ${} substitutions stay on one line', () => {
  const res = prettyPrint('const t=`x${ {a:1} }y`;done();');
  expect(res.lines).toEqual(['const t=`x${ {a:1} }y`;', 'done();']);
});

test('strings containing braces and semicolons are copied verbatim', () => {
  const res = prettyPrint('s="a{b;c}";t(\'d;e\');');
  expect(res.lines).toEqual(['s="a{b;c}";', "t('d;e');"]);
});

test('for-loop head semicolons do not split the line', () => {
  const res = prettyPrint('for(var i=0;i<3;i++){f(i);}');
  expect(res.lines).toEqual(['for(var i=0;i<3;i++){', '  f(i);', '}']);
});

test('else stays attached to the closing brace', () => {
  const res = prettyPrint('if(a){b();}else{c();}');
  expect(res.lines).toEqual(['if(a){', '  b();', '}else{', '  c();', '}']);
});

test('comments never trigger breaks on their braces or semicolons', () => {
  const res = prettyPrint('//x;{\na();/*;{*/b();');
  expect(res.lines).toEqual(['//x;{', 'a();', '/*;{*/b();']);
  expect(res.displayToOriginal).toEqual([0, 1, 1]);
});

test('display lines map back to the original line they started on', () => {
  const res = prettyPrint('var a=1;var b=2;\nvar c=3;');
  expect(res.lines).toEqual(['var a=1;', 'var b=2;', 'var c=3;']);
  expect(res.displayToOriginal).toEqual([0, 0, 1]);
  expect(res.originalToDisplay.get(0)).toBe(0);
  expect(res.originalToDisplay.get(1)).toBe(2);
});

test('raw newlines inside template literals become display lines on the right original line', () => {
  const res = prettyPrint('const t=`one\ntwo`;after();');
  expect(res.lines).toEqual(['const t=`one', 'two`;', 'after();']);
  expect(res.displayToOriginal).toEqual([0, 1, 1]);
});

test('a multi-line minified bundle keeps per-line origins', () => {
  const res = prettyPrint('function calc(a,b){var s=a+b;return s;}\ncalc(1,2);');
  expect(res.lines).toEqual(['function calc(a,b){', '  var s=a+b;', '  return s;', '}', 'calc(1,2);']);
  expect(res.displayToOriginal).toEqual([0, 0, 0, 0, 1]);
});

test('displayLineFor falls back to the next mapped display line', () => {
  const res = prettyPrint('var a=1;\n\nvar b=2;');
  expect(displayLineFor(res, 0)).toBe(0);
  expect(displayLineFor(res, 1)).toBe(1);
  expect(displayLineFor(res, 2)).toBe(1);
  expect(displayLineFor(res, 99)).toBe(res.lines.length - 1);
});

test('nested braces indent cumulatively and dedent on close', () => {
  const res = prettyPrint('a(){b(){c;}}');
  expect(res.lines).toEqual(['a(){', '  b(){', '    c;', '  }', '}']);
});

test('escaped quotes inside strings do not end the string', () => {
  const res = prettyPrint('s="a\\";{";t();');
  expect(res.lines).toEqual(['s="a\\";{";', 't();']);
});

test('division is not mistaken for a regex', () => {
  const res = prettyPrint('var x=a/b;var y=c/d;');
  expect(res.lines).toEqual(['var x=a/b;', 'var y=c/d;']);
});

test('division right after a string or template literal is not mistaken for a regex', () => {
  expect(prettyPrint('var x="a"/b;var y=1;').lines).toEqual(['var x="a"/b;', 'var y=1;']);
  expect(prettyPrint("var x='a'/b;var y=1;").lines).toEqual(["var x='a'/b;", 'var y=1;']);
  expect(prettyPrint('var x=`a`/b;var y=1;').lines).toEqual(['var x=`a`/b;', 'var y=1;']);
});
