// Icons in the static sidebar footer.
document.querySelectorAll('.side-ico[data-ico]').forEach(function (el) { el.innerHTML = RB.icon(el.dataset.ico, 16); });
