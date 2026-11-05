# Status and access, in one place

**Status:** design. Nothing here is built. The capability vocabulary and
`PermissionsAndState` exist; no adapter advertises `per-content-permissions`
today, so the sharing half is hidden on all three CMSes and `shareEntries` is
`null` everywhere.

## Short version

Plone's state menu, except:

- it is in **view mode as well as edit mode**, so publishing does not require
  editing;
- a transition does not fire immediately — it opens a dialog naming what the
  change does to who can see this, with people and roles underneath;
- the list carries **working-copy transitions** too, since checking out a copy
  is a state change;
- and an **access-only entry**, for changing permissions without moving state.

Dates belong here too: "published" is not the truth when an effective date puts
it next week, so status is always shown as the audience that actually applies.

Save stays its own one-tap button. Choosing the current state does nothing.

## The problem

Plone puts three answers to one question in three places: the workflow menu,
the sharing tab, and a working-copy entry in an overflow menu. They are not
three questions. They are "who can see and do what with this, and which
version of it" asked at different resolutions.

In Plone this is literally true rather than an analogy: **a workflow state IS a
role → permission map.** "Published" means the Anonymous role holds View;
"private" means only Owner and Manager do. The state machine does not sit
beside permissions, it switches them wholesale. Local roles are per-principal
exceptions layered on top.

So:

| | granularity |
| --- | --- |
| State | coarse, named, pre-set bundles over *classes* of principal |
| Sharing | fine, per-principal exceptions |

Google Drive collapses the two because for a single document the useful
vocabulary is audience — *Restricted* / *Anyone with the link*, plus what
link-holders may do. That is a state and a role in one control.

## What each CMS actually has

Not one scale but three independent axes: whether grants attach to *this
document* or the whole site, which principals exist, and whether anything is
inherited.

| | scope | principals | inheritance | working copy |
| --- | --- | --- | --- | --- |
| **Plone** | per-object local roles | users, groups, roles | acquired, with a per-object block | yes — `plone.app.iterate`, locked to one holder |
| **WordPress** core | site-wide roles only | users, one role each | none | **no** — revisions are history; no draft of a published post |
| **Drupal** core | site-wide roles only | users, roles | none | yes — Content Moderation pending revisions, not per-user |
| **Drupal** + contrib | per-node (Node Access, ACL) | + groups (Group module) | module-defined | Workspaces stages a whole site |

WordPress is the one that genuinely lacks concepts, not one that spells them
differently. That is what the design has to degrade to.

## Shape

### Sharing is a schema too, transposed

All three CMSes think in **named roles** — Plone's Reader/Editor/Contributor/
Reviewer, WordPress's Subscriber→Administrator, Drupal's roles. A permission
matrix is a shape none of them speaks; we would invent it, map each CMS into
it, and map back on save. Today's grant is exactly that invented shape:

```ts
permissions: Array<'read' | 'edit' | 'publish' | 'delete'>;   // grid-shaped
```

The obvious replacement is Drive's: a list of people, each with a role. It is
the right answer to *"who has access?"*, and the wrong one here, because of
**where the explanation has to live**. Plone has five-plus roles whose meaning
nobody carries in their head and which change per state; a typical document has
a handful of principals. Attach the explanation to a person-row and you repeat
"Reviewer means X while pending" once per person holding it.

So transpose. **Roles are the sections, people are the values** — which is a
schema, and specifically the `Schema` the contract already has:

- **one fieldset per role**, its `description` explaining what the role means
  *here*, in this state, and what changes in the states this document can move
  to;
- **one field in it**, a multi-select of principals over the `principals`
  vocabulary — users and groups together, exactly as the adapter supplies them;
- **one top-level `inherit` boolean**, because Plone's inheritance is per
  object, not per role.

Returned by `state.getForms` under the reserved id `access` — a transition
whose target state is the state it is already in — and written back by
`state.transition` like any other. There is no separate permissions intent,
because there is no separate permissions concept.

This costs no machinery. `vocabulary.get` is already an intent
(`index.d.ts:42`), already routed (`intentRouter.js:258`), already implemented
by all three adapters; `principals` is one more vocabulary name, and a CMS
without groups simply returns none.

**Two small contract additions it does need.** `Schema.fieldsets` has no
`description` field (`index.d.ts:85`), and without one the explanation has
nowhere to live. And the admin must be able to tell *which* fields hold
principals — to count them for the toolbar button and to choose the picker —
which the well-known vocabulary name gives it without a widget escape hatch.

**What this gives up, deliberately:** the per-person answer. *"What can Alice
do here?"* means scanning the fieldsets rather than reading one row. With a
handful of principals that is fine, and the admin can invert the mapping for a
read-only summary if it ever needs to.

**The multi-role case stops being lossy.** Plone lets a principal hold several
local roles at once, which a Drive-style single-select cannot say and would
have had to fudge as "Custom". Role-major says it natively: the principal
appears in both fieldsets.

**What the inherit checkbox cannot tell you** is how many people inherit
access. Plone's `@sharing` reports inherited flags only for principals you have
already searched for; there is no call that counts everyone. Plone's own UI
does not answer it either. We do not invent a number.

### One dialog, two halves

- **People with access** — the role fieldsets from `permissions.get`. Groups
  appear because the adapter's `principals` vocabulary returned them, not
  because of a separate capability, so a CMS without groups degrades by having
  none.
- **General access** — the audience the current state implies. This is where
  the workflow half lives, in Drive's idiom rather than as a separate panel.

Gating:

| section | requires |
| --- | --- |
| State, transitions, "what you can do here" | nothing — every CMS answers |
| People with access | `per-content-permissions` |
| Inherited-from markers, "stop inheriting" | `hierarchical-permissions` |
| Editable vs read-only sharing | `effective.canShare` |
| Add-a-person typeahead | a principal `vocabulary` |

**Degrade to a route, not to emptiness.** WordPress has permissions; they are
site-wide. Hiding the section leaves a real question with no answer, so it
becomes a delegation line — *"Permissions in WordPress are site-wide — Open
Users in WordPress →"* — using the native toolbar actions already built.

### Saving is where state changes

Two of the three CMSes change state at save natively and in one request:
WordPress's *Save draft / Publish / Update*, Drupal's *Save as: Draft |
Published*. Plone's separate transition exists because the person who edits may
not be the person who approves — a reviewer publishing someone else's work has
nothing to save.

Both are needed; the default should be the common one.

- **The primary button states its own consequence** — *Save draft* on a
  private page, **Update live page** on a published one. That carries the
  warning WordPress omits (it gates the first publish but not the update that
  changes what the public sees) without a confirmation step on every save.
- **A state change must travel WITH the save.** Publishing while the form holds
  unsaved edits would publish the *old* content — the user sees "Published" and
  the live page still shows yesterday's text. So `content.update` takes an
  optional transition, applied atomically. WordPress and Drupal do it in the
  single request they would do natively; Plone's adapter saves then transitions
  behind the same intent.
- **Sharing does not ride on save.** It has no relationship to the unsaved
  body. It applies immediately — except when reached from the save flow, where
  committing applies both.

### The control

**No caret on Save.** This toolbar is a row of icon buttons with a full-screen
sheet on mobile; a caret is a second, smaller target glued to a primary one.

The state gets **its own toolbar button** showing the current state, opening a
slide-out (a sheet on mobile, with full-size rows). Save stays one tap that
does one thing. As a separate button it is reachable while *not* editing, which
is the reviewer's path — you should not have to edit something to publish it.

The slide-out is a list of **outcomes**, not states:

```
[ Update live page ]   [ Published ▸ ]      ← two buttons, not one with a caret

   Published            (current)
   Save as draft         keep the live page, work on a copy
   Submit for review     Alice can see and approve it
   Unpublish             remove it from the site
   Change who can access…
```

Choosing anything other than the current state opens the dialog, which names
the target and explains the consequence before committing. The dialog does not
repeat the state list — the slide-out is where the state is chosen; showing it
twice invites "which of these is authoritative?".

**"Draft" is ambiguous on a published page and the two meanings are
opposites**: retract takes the page off the site; a working copy leaves it
exactly as it is. Both exist in Plone. Labelled by consequence, a user cannot
mistake one for the other.

### When: dates are part of the audience

Audience has a time dimension and all three CMSes express it, so the dialog
carries it rather than leaving it to a metadata tab nobody opens.

| | publish at | stop publishing at |
| --- | --- | --- |
| **WordPress** | scheduled publish (`future` status) | — |
| **Plone** | effective date | expiration date |
| **Drupal** | contrib (Scheduler), not core | contrib |

Plone's is the awkward one and the reason this cannot be left out: effective
and expiration are a **second visibility mechanism running alongside
workflow**. A document can be `published` and still invisible because its
effective date is next week — Plone's own UI will cheerfully show "Published"
while the page 404s for anonymous.

So: **the state name is not the truth, the effective audience is.** Anywhere
this design shows a status — the toolbar button, the slide-out, the dialog —
it shows what is actually true now, with the date as the qualifier:

```
Published — from Tuesday 9 Sept        (not yet visible)
Published — until 30 Sept
```

A scheduled change is the same transition with a date attached, so it needs no
special case in the contract: the date is a field on the publish transition's
schema (below), and the save flow reads *Save & publish on Tuesday*. Where a
CMS has no expiry the field is simply not in the schema, on the same principle
as every other capability gate: absent, not empty and inert.

### Working copies are transitions

Checking out a copy *is* a state change, so it needs no separate concept:
adapters that support it simply offer more transitions — *Save as draft*,
*Publish draft*, *Discard draft* — in the same list. Drupal maps them to
moderation states, Plone to `iterate` check-out/check-in, WordPress offers
none and the list is shorter.

Semantics, stated neutrally so no adapter has to lie:

- The version you get **depends on what you are doing**: view resolves to
  published, edit resolves to the draft. `content.get` must carry which
  resolution is wanted; today it takes a path and returns *the* document.
- There is **one** draft ahead of the published version. Drupal accumulates
  many draft *revisions* but only the latest is editable; Plone allows one
  working copy at a time.
- **Exclusivity is Plone's, not everyone's.** Plone locks the copy to whoever
  checked it out; a Drupal pending revision is visible and editable by anyone
  with the permission. So the model says *"a draft ahead of the published
  version, held by ⟨principal⟩ or by no one"*, with locking as a separate thing
  Plone advertises. "Your draft" would make Drupal misrepresent shared drafts
  as personal ones.
- **A transition can redirect the editing session.** Ordinary transitions
  change this document's state; check-out produces a second object and moves
  editing onto it. `state.transition` must be able to reply "you are now
  editing ⟨id⟩" or the button appears to do nothing.
- Drupal **Workspaces** is the case that breaks "one draft". It belongs as
  session context — an active workspace, like a branch, changing what every
  path resolves to — not as an array of drafts per document.

### A transition may ask for more than confirmation

Publishing is rarely just publishing. WordPress wants a date, a visibility and
maybe a password; Drupal wants a revision log message; Plone wants effective
and expiration dates. There is no closed set of these and no reason to invent
one, so **a transition carries a schema of what may be set when taking it**,
fetched by a second intent:

```ts
| 'state.get'         // hot path, per content view: state + transitions only
| 'state.getForms'    // on menu open: every transition -> { schema, data }
| 'state.transition'  // takes `data`
```

Split because `state.get` is hot — Plone's `@actions` maps to it and the admin
requests that on every content view — so schemas riding along would make the
common path pay for the rare one. All transitions come back together rather
than one per click because the expensive part, the current grants, is shared
between them.

`Schema` is the type the contract already has, so this adds no machinery: the
same renderer that draws the sidebar draws the dialog. Two further properties
fall out rather than needing design. Transitions are already computed per
object per user, so a schema is automatically per *(object, user,
transition)* — publishing from `draft` can ask for different fields than
publishing from `pending`. And WordPress's pre-publish panel stops being a
special case we hardcode; it is just the schema its adapter emits.

| transition | schema |
| --- | --- |
| WordPress publish | `date`, `visibility`, `password`, `slug` |
| Drupal publish | `revision_log`; with Content Moderation, the workflow's own |
| Plone publish | `effective`, `expires`, `comment` |
| Plone check out | none — the dialog is the sentence and a confirm |

**What goes in a transition's form is the adapter's curation, not a rule about
endpoints.** The question each field answers is *what matters about where and
how this appears, at this moment* — so it may be metadata the document already
carries, repeated here because this is when anyone actually thinks about it.
Plone's short name lives in a metadata accordion and is therefore set only
after the URL is already wrong; WordPress has always asked for the slug in its
pre-publish panel, and is right to. Retracting asks for neither.

That some of these persist independently of state is not an argument against
them: so do sharing and effective dates, which nobody doubts belong here.

The cost is the adapter's to carry. Plone's `@workflow` takes only `comment`,
`effective`, `expires` and `include_children`, so anything else is a second
write against the document — transition first, so the second call addresses a
path that still exists, since renaming changes it. A rename then answers
`{ redirect }` for the same reason a checkout does: the editor must not be left
looking at an address that no longer resolves.

**Undeclared values are refused, not dropped.** A field the schema did not
declare fails the transition with `BAD_REQUEST`. Silently discarding it is the
dangerous version: the dialog reports success for a setting that never took,
and the first sign of trouble is the wrong audience seeing the document.

**Two carriers, because the menu is in view mode too.** Publishing must not
require going through a save, so `state.transition` takes the form's answers
standalone. When there IS a body to save at the same time, the same values ride
on `content.update` instead — which is what two of the three CMSes do natively
in one request anyway.

### The adapter writes the sentence

"Reviewer" is meaningless in `published` and decisive in `pending`, and no CMS
tells you so; you are expected to know the workflow definition.

> **Reviewer** — can approve this while it is *pending*. No effect once
> published.

The tempting design is a projection the frontend computes: roles declare what
they imply and which states they matter in, and the admin composes prose from
it. That is a small DSL, and it is the wrong side of the boundary — every
adapter would encode its workflow into our vocabulary so we could decode it
back into English.

The fieldset `description` removes the need. **The adapter writes the
sentence**, because the adapter is what knows: Plone computes it from the
per-state role→permission matrix that *is* its workflow definition; Drupal from
the transition permissions its roles hold; WordPress writes a static line —
"can edit anything on this site" — which is still truer than a bare role name.

Same reasoning as `consequence` on a transition, one level down: prose the
party with the knowledge writes, not structure the party without it decodes.

## Open questions

1. **Three changes to the contract, all breaking, all free today.**
   `shareEntries` is replaced by a schema from `permissions.get`; transitions
   gain `consequence` and `schema`; `Schema.fieldsets` gains `description`.
   Nothing consumes the first two — WordPress and Drupal return
   `shareEntries: null`, Plone does not implement `permissions.get` at all — so
   the cost is now or never.
2. **Which adapter lights it up first.** Plone is the only one that can express
   per-content grants, groups and inheritance — and implementing
   `permissions.get`/`update` there makes the contract suite's existing
   `sharing` probe start holding it to account.
3. **Drupal draft transitions cannot be tested as things stand.** The harness
   runs a captured mock that knows nothing about moderation states or
   revisions; fixtures would need re-capturing against a real Drupal with
   Content Moderation enabled. This is the §2.1 mock-drift risk, which already
   bit once when the adapter and the mock disagreed about sorting.
4. **What happens to images when a working copy is activated.** Check out,
   edit, upload new images, check in — and it is unclear whether images added
   to the working copy survive. Plone's `plone.app.iterate` copies the object,
   but an image uploaded as its own content object lives at the working copy's
   path, and a reference stored by uid may resolve to something about to be
   discarded. The failure is silent and looks like a broken image after a
   successful publish. Needs establishing per CMS before working-copy
   transitions ship, not before they are designed.
5. **Whether the sharing half applies immediately in edit mode** while state is
   deferred to the save. Recommended, since access does not depend on the body
   — but the dialog must say which half is which rather than leave it inferred.
