// A short confirmation at the bottom of the screen, such as "Added this ad to the existing job."

export const toast = $state({ message: '' });

let timer: ReturnType<typeof setTimeout> | undefined;

export function showToast(message: string): void {
  toast.message = message;
  clearTimeout(timer);
  timer = setTimeout(() => (toast.message = ''), 5000);
}
