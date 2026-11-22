// Launch gate for the main site pages (loaded in <head>, before anything paints).
// While the site is in the "waitlist" phase (Admin → Overview), visitors are sent to /waitlist.
// The page stays invisible until the answer arrives; if the check fails the page is shown rather than locking people out.
(function () {
  var d = document.documentElement, shown = false;
  function show() { if (!shown) { shown = true; d.style.visibility = ''; } }
  d.style.visibility = 'hidden';
  setTimeout(show, 4000);
  fetch('/api/launch', { credentials: 'same-origin', cache: 'no-store' })
    .then(function (r) { return r.json(); })
    .then(function (j) { if (j && j.gated) location.replace('/waitlist'); else show(); })
    .catch(show);
})();
