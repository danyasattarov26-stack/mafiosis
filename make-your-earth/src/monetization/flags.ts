/* Feature flags. Payments are not built yet: the "Support the game" button stays hidden until FLAGS.support is on. */
export const FLAGS = {
  support: import.meta.env.VITE_SUPPORT_BUTTON === '1',
};
