---
"@type": Document
UID: site-footer-uid
id: site-footer
review_state: published
title: Site Footer
description: Footer with social links and copyright
effective: 2025-01-01T00:00:00
blocks-matched: |
  <block is="slate" value="${p,h*,ul,ol,blockquote,strong,em/slate}" />
---

<fields templateId="/inka-templates/site-footer" templateInstanceId="site-footer-def-instance" data-json='{"fixed":true,"readOnly":true}'>

<block is="socialLinks" slotId="social" data-json='{"links":[{"@type":"socialLink","slotId":"social-link","@id":"link-1","url":[{"@id":"https://github.com/collective/volto-hydra"}],"fixed":true,"readOnly":true,"templateId":"/inka-templates/site-footer","templateInstanceId":"site-footer-def-instance"},{"@type":"socialLink","slotId":"social-link","@id":"link-2","url":[{"@id":"https://discord.gg/plone"}],"fixed":true,"readOnly":true,"templateId":"/inka-templates/site-footer","templateInstanceId":"site-footer-def-instance"},{"@type":"socialLink","slotId":"social-link","@id":"link-3","url":[{"@id":"https://plone.org"}],"fixed":true,"readOnly":true,"templateId":"/inka-templates/site-footer","templateInstanceId":"site-footer-def-instance"},{"@type":"socialLink","slotId":"social-link","@id":"link-4","url":[{"@id":"https://www.youtube.com/@plonecms"}],"fixed":true,"readOnly":true,"templateId":"/inka-templates/site-footer","templateInstanceId":"site-footer-def-instance"}]}' />

<block is="slate">

Inka — design-system-first page building. © 2024-2026 Plone Foundation.

<fields slotId="copyright" />

</block>

</fields>
