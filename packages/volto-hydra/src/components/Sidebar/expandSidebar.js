/**
 * Open the settings sidebar if it is collapsed (on a phone it always starts
 * so), through the same trigger the sidebar's own button uses.
 */
export const expandSidebar = () => {
  const sidebarContainer = document.querySelector('.sidebar-container');
  if (sidebarContainer?.classList.contains('collapsed')) {
    sidebarContainer.querySelector('.trigger')?.click();
  }
};
