// Pick light or dark before the page draws, so it never flashes the wrong colours.
(function () {
  var p = 'system';
  try { p = localStorage.getItem('rackbook.theme') || 'system'; } catch (e) {}
  var dark = p === 'dark' || (p !== 'light' && window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.setAttribute('data-theme', dark ? 'dark' : 'light');
})();
