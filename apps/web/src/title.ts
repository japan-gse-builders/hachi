import { useEffect } from 'react';

export const pageTitle = (title?: string) => (title ? `${title} · Hachi` : 'Hachi');

/** Each screen names itself, so tabs and browser history tell staff which case or resident they hold. */
export function useDocumentTitle(title?: string) {
  useEffect(() => {
    document.title = pageTitle(title);
  }, [title]);
}
