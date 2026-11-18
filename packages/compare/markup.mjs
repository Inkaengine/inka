/**
 * The markup measure: a DOM node as a canonical string, so two renders of the
 * same component compare equal exactly when their structure does.
 *
 * Attributes and class tokens are sorted and de-duplicated (order and
 * multiplicity are not structure); text, URLs, ids and form-control names are
 * tokens (instance data, not structure), and adjacent text nodes are one text; inline styles have their punctuation
 * normalised (never which properties, nor their values); and an editor's own
 * attributes (data-block-*, data-edit-*, data-linkable-* and the like) are
 * dropped, since a design system has no part in them.
 *
 * Returned as SOURCE, to be run in the page:
 *
 *   const serialize = new Function(serializerSource({ rewrite: null }) + "; return serialize;")();
 *
 * `rewrite`, when given, is the source of `function (el, t, a, inner)`
 * returning `{ t, a, inner }`: a comparison's own canonicalisation of a
 * difference it accepts in an element's tag, attributes or serialised
 * children, run on each element once its children are serialised. It belongs
 * to a design system, not to this module; null when there is none.
 */
export function serializerSource({ rewrite }) {
  if (rewrite === undefined) throw new TypeError("serializerSource: rewrite, a function's source, or null for none");
  return `var REWRITE=${rewrite ?? "null"};
function serialize(node){
  if(node.nodeType===3){return node.textContent.replace(/\\s+/g,' ').trim()?'§T§':'';}
  if(node.nodeType!==1)return '';
  var el=node,EDIT=/^(data-block-|data-edit-|data-node-id|data-v-|data-linkable-|data-analytics-|contenteditable$)/,URL={href:1,src:1,srcset:1,'xlink:href':1,id:1,'for':1,'aria-controls':1,'aria-labelledby':1,'aria-describedby':1,'aria-owns':1},a=[];
  // An element carrying data-linkable-* also has an id that is its deep-link
  // (#fragment) anchor — an additive in-page-nav enhancement (every heading
  // becomes a target), not part of a design system's markup. Drop that id with the
  // stripped data-linkable-*, so the structure still compares.
  var LINK=false;for(var j=0;j<el.attributes.length;j++){if(/^data-linkable-/.test(el.attributes[j].name)){LINK=true;break;}}
  for(var i=0;i<el.attributes.length;i++){var x=el.attributes[i];if(EDIT.test(x.name))continue;if(LINK&&x.name==='id')continue;var v=x.value;
    if(x.name==='class'){var seen={},toks=[];v.split(/\\s+/).filter(Boolean).forEach(function(c){if(!seen[c]){seen[c]=1;toks.push(c);}});v=toks.sort().join(' ');}
    else if(URL[x.name])v='§U§';
    // A form control's \`name\` is the field being submitted — instance data,
    // like an id. A design system's mockups hardcode demo names while ours is
    // whatever the author called the question, so comparing them strictly
    // fails every real field for saying what it is. Tokenised like ids; the
    // control's class, type and structure stay strict.
    else if(x.name==='name'&&/^(input|select|textarea|button)$/.test(el.tagName.toLowerCase()))v='§NAME§';
    else if(x.name==='style')v=v.replace(/url\\([^)]*\\)/g,'url(§U§)').replace(/\\s*([:;])\\s*/g,'$1').replace(/;+$/,'').replace(/\\s+/g,' ').trim();
    a.push(x.name+'="'+v+'"');}
  a.sort();var inner='';for(var j=0;j<el.childNodes.length;j++)inner+=serialize(el.childNodes[j]);
  // Adjacent text nodes are one text in the HTML (React splits adjacent
  // strings, with a comment between them when server-rendered).
  inner=inner.replace(/(§T§)+/g,'§T§');
  var t=el.tagName.toLowerCase();
  if(REWRITE){var r=REWRITE(el,t,a,inner);t=r.t;a=r.a;inner=r.inner;}
  return '<'+t+(a.length?' '+a.join(' '):'')+'>'+inner+'</'+t+'>';
}`;
}
