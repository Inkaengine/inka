from plone.base.interfaces.installable import INonInstallable
from zope.interface import implementer


@implementer(INonInstallable)
class HiddenProfiles:
    def getNonInstallableProfiles(self):
        """Hide uninstall profile from site-creation and quickinstaller."""
        return [
            "inkaengine.inka:uninstall",
        ]

    def getNonInstallableProducts(self):
        """Nothing to hide — the scaffold's upgrades package was removed unused."""
        return []
