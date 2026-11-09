// The editor's pop-up messages. Field validation never shows one; a helper that
// does (a file-upload size check) is not something the offline check calls.
const unavailable = () => {
  throw new Error('Volto pop-up messages are not available in the offline content check');
};
export const toast = { error: unavailable, success: unavailable, info: unavailable };
export default unavailable;
