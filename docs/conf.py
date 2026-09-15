# Configuration file for the Sphinx documentation builder.
# https://www.sphinx-doc.org/en/master/usage/configuration.html

# -- Project information -----------------------------------------------------

project = "Volto Hydra"
copyright = "2024, Plone Collective"
author = "Plone Collective"

# -- General configuration ---------------------------------------------------

extensions = [
    "myst_parser",
    "sphinx_copybutton",
]

# MyST configuration
myst_enable_extensions = [
    "colon_fence",
    "linkify",
    "substitution",
    "deflist",
]
myst_heading_anchors = 3

# Source settings
source_suffix = {
    ".md": "markdown",
}

# Exclude patterns
exclude_patterns = [
    "_build",
    "_myst",  # generated Sphinx source (gen:myst); built separately, not in-place
    "Thumbs.db",
    ".DS_Store",
    "**/node_modules",
    "**/test-react",
    "**/test-vue",
    "**/test-svelte",
    "**/examples",
    "**/fixtures",
    "**/*.mjs",
    "**/*.json",
    "content/**",
]

# -- Options for HTML output -------------------------------------------------

html_theme = "sphinx_book_theme"

html_theme_options = {
    "repository_url": "https://github.com/collective/volto-hydra",
    "use_repository_button": True,
    "use_edit_page_button": True,
    "path_to_docs": "docs",
    "show_toc_level": 2,
    "navigation_with_keys": True,
    "announcement": "⚠️ Volto Hydra is a Work in Progress — not yet recommended for production use.",
}

html_title = "Volto Hydra Documentation"
html_logo = None
html_favicon = None

# Static asset directory — anything in docs/_static/ ships as-is in the
# built site under /_static/. Used for the homepage demo video.
html_static_path = ["_static"]

# -- Options for copybutton --------------------------------------------------

copybutton_prompt_text = r">>> |\.\.\. |\$ "
copybutton_prompt_is_regexp = True
