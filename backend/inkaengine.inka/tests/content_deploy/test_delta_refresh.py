"""A page asked for by name is re-imported from the layout.

The delta reads a live page only where the layout changed it since the last
apply, and leaves a live page that differs from that base alone: it is an
editor's edit. A page saved in the editor from older data kept a link the
layout had since fixed, and no delta would ever replace it. `refresh` names
the pages to take from the layout anyway.
"""

from inkaengine.inka.content_deploy.classify import classify
from inkaengine.inka.content_deploy.classify import refresh_from_disk

import copy
import pytest


PAGE = {
    "@id": "/contact/form",
    "@type": "Document",
    "UID": "uid-form-00000000000000000000000000",
    "id": "form",
    "title": "Form",
    "blocks": {"b1": {"@type": "slate", "value": [{"text": "converted"}]}},
}


def _edited():
    page = copy.deepcopy(PAGE)
    page["blocks"]["b1"]["value"] = [{"text": "an old save"}]
    return page


def test_an_edited_page_the_layout_did_not_change_is_left():
    plan = classify(
        {"contact/form": PAGE}, {"contact/form": PAGE}, {"contact/form": _edited()}
    )
    assert plan.leaves == ["contact/form"]
    assert plan.updates == []


def test_refreshed_it_is_updated_from_the_layout_with_no_clobber_warning():
    base, disk, live = (
        {"contact/form": PAGE},
        {"contact/form": PAGE},
        {"contact/form": _edited()},
    )
    plan = classify(base, disk, live)
    refresh_from_disk(plan, ["contact/form"], disk, live)
    assert plan.updates == ["contact/form"]
    assert plan.leaves == []
    assert plan.warnings == []


def test_a_refreshed_page_that_already_matches_stays_a_noop():
    same = {"contact/form": PAGE}
    plan = classify(same, same, same)
    refresh_from_disk(plan, ["contact/form"], same, same)
    assert plan.updates == []
    assert plan.noops == ["contact/form"]


def test_a_refresh_naming_a_page_the_layout_does_not_have_fails():
    plan = classify({}, {}, {})
    with pytest.raises(ValueError, match="contact/gone"):
        refresh_from_disk(plan, ["contact/gone"], {}, {})


def test_a_refresh_naming_a_page_not_on_the_site_fails():
    disk = {"contact/form": PAGE}
    plan = classify({}, disk, {})
    with pytest.raises(ValueError, match="not on the site"):
        refresh_from_disk(plan, ["contact/form"], disk, {})
