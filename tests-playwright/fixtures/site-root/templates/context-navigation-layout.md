---
"@type": Document
UID: context-navigation-layout-uid
id: context-navigation-layout
review_state: published
title: Context Navigation Layout
description: Forced layout for 3rd-level pages — injects a contextNavigation
  (auto-populated from sibling pages via listing+depth) above the page content.
blocks-matched: |
  <block type="slate" value="${p,h*,ul,ol,blockquote,strong,em/slate}" />
---

<fields templateId="/templates/context-navigation-layout" templateInstanceId="context-navigation-layout-def-instance">

<block type="contextNavigation" slotId="context-navigation" ariaLabel="In this section" data-json='{"fixed":true,"readOnly":true,"blocks":{"tpl-cnav-listing":{"@type":"listing","variation":"navItem","fixed":true,"readOnly":true,"templateId":"/templates/context-navigation-layout","templateInstanceId":"context-navigation-layout-def-instance","slotId":"context-navigation-listing","fieldMapping":{"@id":{"field":"href","type":"link"},"title":{"field":"label"}},"querystring":{"query":[{"i":"path","o":"plone.app.querystring.operation.string.relativePath","v":".."},{"i":"portal_type","o":"plone.app.querystring.operation.selection.none","v":["Image","File"]},{"i":"exclude_from_nav","o":"plone.app.querystring.operation.boolean.isFalse","v":""}],"sort_on":"getObjPositionInParent","depth":4}}},"blocks_layout":{"items":["tpl-cnav-listing"]}}' />

<block type="slate" slotId="default" data-json='{"value":[{"type":"p","children":[{"text":""}]}],"fixed":false}' />

</fields>
