<div align="center">
    <h1 align="center">inkaengine.inka</h1>
</div>
<div align="center">
[![PyPI](https://img.shields.io/pypi/v/inkaengine.inka)](https://pypi.org/project/inkaengine.inka/)
[![PyPI - Python Version](https://img.shields.io/pypi/pyversions/inkaengine.inka)](https://pypi.org/project/inkaengine.inka/)
[![PyPI - Wheel](https://img.shields.io/pypi/wheel/inkaengine.inka)](https://pypi.org/project/inkaengine.inka/)
[![PyPI - License](https://img.shields.io/pypi/l/inkaengine.inka)](https://pypi.org/project/inkaengine.inka/)
[![PyPI - Status](https://img.shields.io/pypi/status/inkaengine.inka)](https://pypi.org/project/inkaengine.inka/)


[![PyPI - Plone Versions](https://img.shields.io/pypi/frameworkversions/plone/inkaengine.inka)](https://pypi.org/project/inkaengine.inka/)

![Code Style](https://img.shields.io/badge/Code%20Style-Black-000000)

[![GitHub contributors](https://img.shields.io/github/contributors/Inkaengine/inkaengine.inka)](https://github.com/Inkaengine/inkaengine.inka)
[![GitHub Repo stars](https://img.shields.io/github/stars/Inkaengine/inkaengine.inka?style=social)](https://github.com/Inkaengine/inkaengine.inka)

</div>

Backend support for the Inka engine

## Features

TODO: List our awesome features

## Installation

Install inkaengine.inka with `pip`:

```shell
pip install inkaengine.inka
```

And to create the Plone site:

```shell
make create-site
```

## Contribute

- [Issue tracker](https://github.com/Inkaengine/inkaengine.inka/issues)
- [Source code](https://github.com/Inkaengine/inkaengine.inka/)

### Prerequisites ✅

-   An [operating system](https://6.docs.plone.org/install/create-project-cookieplone.html#prerequisites-for-installation) that runs all the requirements mentioned.
-   [uv](https://6.docs.plone.org/install/create-project-cookieplone.html#uv)
-   [Make](https://6.docs.plone.org/install/create-project-cookieplone.html#make)
-   [Git](https://6.docs.plone.org/install/create-project-cookieplone.html#git)
-   [Docker](https://docs.docker.com/get-started/get-docker/) (optional)

### Installation 🔧

1.  Clone this repository, then change your working directory.

    ```shell
    git clone git@github.com:Inkaengine/inkaengine.inka.git
    cd inkaengine.inka
    ```

2.  Install this code base.

    ```shell
    make install
    ```


### Add features using `plonecli` or `bobtemplates.plone`

This package provides markers as strings (`<!-- extra stuff goes here -->`) that are compatible with [`plonecli`](https://github.com/plone/plonecli) and [`bobtemplates.plone`](https://github.com/plone/bobtemplates.plone).
These markers act as hooks to add all kinds of subtemplates, including behaviors, control panels, upgrade steps, or other subtemplates from `plonecli`.

To run `plonecli` with configuration to target this package, run the following command.

```shell
make add <template_name>
```

For example, you can add a content type to your package with the following command.

```shell
make add content_type
```

You can add a behavior with the following command.

```shell
make add behavior
```

```{seealso}
You can check the list of available subtemplates in the [`bobtemplates.plone` `README.md` file](https://github.com/plone/bobtemplates.plone/?tab=readme-ov-file#provided-subtemplates).
See also the documentation of [Mockup and Patternslib](https://6.docs.plone.org/classic-ui/mockup.html) for how to build the UI toolkit for Classic UI.
```

## License

The project is licensed under GPLv2.

## Credits and acknowledgements 🙏

Generated using [Cookieplone (2.0.0)](https://github.com/plone/cookieplone) and [cookieplone-templates (db76a81)](https://github.com/plone/cookieplone-templates/commit/db76a81d89db7ed23d6873e5323bdbfc63cd6197) on 2026-09-22 16:18:58.330151. A special thanks to all contributors and supporters!
