---
name: "Instructions: Backend addon documentation"
description: "Standards and guidelines for backend addon documentation files."
applyTo: "README.md,docs/docs/**/*.md,docs/README.md"
---

# Backend addon documentation standards

## 0. General guidelines

Always read the general rules for Plone documentation in ./general/docs.md

## 1. All files

- ALWAYS use emojis in section titles for a friendly tone.
- ALWAYS recommend using `make` commands for installation and starting the project:
    - ALWAYS recommend using `make install` to install the project, as this handles all dependencies and setup.
    - ALWAYS recommend using `make start` to start the Plone process, as this ensures proper configuration.
- NEVER recomend using `pip install`, `uv add`  or `uv pip` directly.
- NEVER edit the paragraph refering to `cookieplone`. Usually starting with **Generated using**.

## 2. README.md at the top level of the repository

- Must provide a clear overview of the addon
- Will be viewed on GitHub
- Will be viewed also on PyPI
- Must provide installation instructions for end users.
- Must provide installation for developers willing to contribute to this add-on.
- Must describe the features.
    - Example:
        - ✅: `- Register a behavior providing additiional fields representing contact information` .
        - ❌: `- Behavior` .
    - Review the code if necessary to explain it.


## 3. docs/README.md
- Must provide detailed documentation for developers **documenting** the project
