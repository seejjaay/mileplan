/** Navigates to a (signed, content-disposition: attachment) URL. Isolated so tests can stub it. */
export function openUrl(url: string): void {
  window.location.assign(url)
}
