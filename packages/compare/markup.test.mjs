/**
 * The markup measure: two renders compare equal exactly when their structure
 * does.
 *
 *   node --test packages/compare/markup.test.mjs
 */
import assert from "node:assert/strict";
import test from "node:test";
import { JSDOM } from "jsdom";

import { serializerSource } from "./markup.mjs";

function serializer(rewrite = null) {
  const { window } = new JSDOM("<!doctype html><body></body>");
  const serialize = new window.Function(serializerSource({ rewrite }) + "; return serialize;")();
  return (html) => {
    window.document.body.innerHTML = html;
    return serialize(window.document.body.firstElementChild);
  };
}

test("attribute and class order, and a repeated class, are not structure", () => {
  const s = serializer();
  assert.equal(
    s('<div id="x" class="ui-b ui-a ui-a" role="note"></div>'),
    s('<div role="note" class="ui-a ui-b" id="y"></div>'),
  );
  assert.equal(s('<div class="ui-a ui-b"></div>'), '<div class="ui-a ui-b"></div>');
});

test("text, links, ids and a form control's name are instance data, not structure", () => {
  const s = serializer();
  assert.equal(s('<a href="/one">One</a>'), s('<a href="/two">Two words</a>'));
  assert.equal(s('<a href="/one">One</a>'), '<a href="§U§">§T§</a>');
  assert.equal(s('<input name="question-7" type="text">'), '<input name="§NAME§" type="text"></input>');
  assert.notEqual(s('<input type="text">'), s('<input type="checkbox">'), "the type is structure");
});

test("text split into adjacent text nodes is one text, as the HTML is", () => {
  const s = serializer();
  // React writes adjacent strings as separate text nodes, with a comment
  // between them in server-rendered markup: the same HTML as one text.
  assert.equal(s("<span>A<!-- -->B</span>"), s("<span>AB</span>"));
  assert.equal(s("<span>A<!-- -->B</span>"), "<span>§T§</span>");
  // An element between them still separates them.
  assert.equal(s("<span>A<b>x</b>B</span>"), "<span>§T§<b>§T§</b>§T§</span>");
});

test("an inline style's punctuation is normalised, never its properties or values", () => {
  const s = serializer();
  assert.equal(s('<div style="color: red; margin: 0;"></div>'), s('<div style="color:red;margin:0"></div>'));
  assert.notEqual(s('<div style="color:red"></div>'), s('<div style="color:blue"></div>'));
});

test("an editor's own attributes are dropped, with the deep-link id they bring", () => {
  const s = serializer();
  assert.equal(
    s('<h2 id="anchor" data-linkable-allow="" data-block-uid="b1" data-edit-text="title" contenteditable="true">T</h2>'),
    "<h2>§T§</h2>",
  );
});

test("a comparison's rewrite runs on each element once its children are serialised", () => {
  const rewrite = `function(el,t,a,inner){
    if(t==='form'&&/(^|\\s)ui-panel(\\s|$)/.test(el.getAttribute('class')||''))t='div';
    return {t:t,a:a.filter(function(s){return !/^action=/.test(s);}),inner:inner.replace('<b>§T§</b>','')};
  }`;
  const s = serializer(rewrite);
  assert.equal(s('<form class="ui-panel" action="/go"><b>x</b><i>y</i></form>'), '<div class="ui-panel"><i>§T§</i></div>');
  // Without the rewrite, the same form is printed as it is.
  assert.equal(serializer()('<form class="ui-panel" action="/go"></form>'), '<form action="/go" class="ui-panel"></form>');
});

test("the rewrite is always stated, even as none", () => {
  assert.throws(() => serializerSource({}), /rewrite/);
});
