// The one JSX in FormValidation draws a pop-up (see toast.js).
const unavailable = () => {
  throw new Error('JSX is not available in the offline content check');
};
export const jsx = unavailable;
export const jsxs = unavailable;
export const Fragment = null;
