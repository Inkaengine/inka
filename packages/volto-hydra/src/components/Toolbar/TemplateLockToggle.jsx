import React from 'react';
import { Icon } from '@plone/volto/components';
import lockSVG from '@plone/volto/icons/lock.svg';
import unlockSVG from '@plone/volto/icons/unlock.svg';

/**
 * The ONE lock/unlock control for a template instance.
 *
 * Locking/unlocking is a WHOLE-TEMPLATE action — never per-block. This is the
 * single button rendered in BOTH surfaces that expose it: the settings sidebar
 * (ParentBlocksWidget) and the quanta block toolbar (SyncedSlateToolbar). One
 * component, one behaviour — so the two can never drift apart (that drift is what
 * made the quanta toggle miss editable members while the sidebar showed it).
 *
 * Locked (`editing` = false) → 🔒, click to unlock & edit the template's structure.
 * Unlocked → 🔓, click to lock (review & save). The click always toggles the whole
 * instance via `onToggle(instanceId)`.
 *
 * Each surface keeps its own contract class so unscoped selectors stay unambiguous:
 * the toolbar variant renders `template-lock-toggle lock-icon` (toolbar tests +
 * AdminUIHelper), the sidebar variant renders `edit-template-toggle` (sidebar
 * tests). `variant` only tweaks class + presentation (size / background), never
 * behaviour.
 *
 * @param {string} instanceId - the template instance this toggles
 * @param {boolean} editing - is the instance currently unlocked/being edited
 * @param {boolean} [canEdit=true] - user may edit this template (else disabled)
 * @param {(instanceId: string) => void} onToggle
 * @param {boolean} [opens=false] - a locked block's lock on the canvas: clicking
 *   it opens the template (onToggle selects it) rather than unlocking, so it says
 *   so, and is never disabled — anyone may look (inka#774).
 * @param {'sidebar'|'toolbar'} [variant='sidebar']
 */
export default function TemplateLockToggle({
  instanceId,
  editing,
  canEdit = true,
  onToggle,
  opens = false,
  variant = 'sidebar',
}) {
  const toolbar = variant === 'toolbar';
  // Opening a template is only looking: nobody needs permission for that.
  const enabled = opens || canEdit;
  return (
    <button
      type="button"
      className={
        toolbar
          ? 'template-lock-toggle lock-icon'
          : `edit-template-toggle${
              editing ? ' edit-template-toggle--active' : ''
            }`
      }
      aria-pressed={editing}
      aria-label={
        opens
          ? 'Locked by its template: open the template'
          : editing
          ? 'Lock template'
          : 'Unlock template to edit'
      }
      disabled={!enabled}
      title={
        opens
          ? 'Locked: this block belongs to a template. Open the template to see more.'
          : canEdit
          ? editing
            ? 'Lock template (review & save changes)'
            : 'Unlock to edit this template'
          : 'You don’t have permission to edit this template (requires “Modify portal content”).'
      }
      onClick={(e) => {
        e.stopPropagation();
        if (enabled) onToggle(instanceId);
      }}
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        border: 'none',
        borderRadius: '2px',
        pointerEvents: 'auto',
        cursor: enabled ? 'pointer' : 'not-allowed',
        opacity: enabled ? 1 : 0.5,
        padding: toolbar ? '4px 6px' : '4px',
        background: toolbar ? '#f5f5f5' : 'none',
      }}
      onMouseEnter={(e) =>
        enabled && (e.currentTarget.style.background = '#e8e8e8')
      }
      onMouseLeave={(e) =>
        (e.currentTarget.style.background = toolbar ? '#f5f5f5' : 'none')
      }
    >
      <Icon
        name={editing ? unlockSVG : lockSVG}
        size={toolbar ? '16px' : '20px'}
        color={editing ? '#0b78d0' : '#684cc9'}
      />
    </button>
  );
}
