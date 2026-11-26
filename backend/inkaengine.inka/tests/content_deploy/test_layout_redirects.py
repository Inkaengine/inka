"""The layout's redirects reach live.

The incremental sync only ever made redirects for its own moves and deletes,
so a redirects.json written alongside the layout would never reach the site.
`layout_redirects` carries the entries the base did not have, as site-relative
pairs (apply_redirects adds the site's physical path back).
"""

from inkaengine.inka.content_deploy.classify import layout_redirects

import pytest


class TestLayoutRedirects:
    def test_new_redirects_become_site_relative_pairs(self):
        assert layout_redirects(
            {"/site/news/x": "/site/articles/x", "/site/gone": "/site"}, {}, "/site"
        ) == [("/news/x", "/articles/x"), ("/gone", "/")]

    def test_a_redirect_the_base_already_had_is_not_reapplied(self):
        assert layout_redirects(
            {"/site/a": "/site/b", "/site/c": "/site/d"},
            {"/site/a": "/site/b", "/site/c": "/site/old-d"},
            "/site",
        ) == [("/c", "/d")]

    def test_the_old_export_form_in_the_base_counts_as_absent(self):
        # the base still holds an export's /old_root/... keys, which
        # never worked, so every normalised redirect is new once.
        assert layout_redirects(
            {"/site/a": "/site/b"},
            {"/old_root/mnt/site/a": "/old_root/mnt/site/b"},
            "/site",
        ) == [("/a", "/b")]

    def test_a_redirect_outside_the_site_fails_loudly(self):
        with pytest.raises(ValueError, match="/old_root/mnt/site/a"):
            layout_redirects({"/old_root/mnt/site/a": "/site/b"}, {}, "/site")
