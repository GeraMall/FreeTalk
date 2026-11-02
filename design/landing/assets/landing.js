/* global document, IntersectionObserver */
const menuButton = document.querySelector('.menu-button');
const nav = document.querySelector('.nav');
function setMenuOpen(open) {
  nav.classList.toggle('open', open);
  menuButton.setAttribute('aria-expanded', String(open));
  menuButton.setAttribute('aria-label', open ? 'Закрыть меню' : 'Открыть меню');
}
menuButton.addEventListener('click', () => {
  setMenuOpen(!nav.classList.contains('open'));
});
document.querySelectorAll('.nav-links a').forEach((link) =>
  link.addEventListener('click', () => {
    setMenuOpen(false);
  }),
);
nav.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && nav.classList.contains('open')) {
    setMenuOpen(false);
    menuButton.focus();
  }
});
const observer = new IntersectionObserver(
  (entries) =>
    entries.forEach((entry) => {
      if (entry.isIntersecting) {
        entry.target.classList.add('visible');
        observer.unobserve(entry.target);
      }
    }),
  { threshold: 0.12 },
);
document.querySelectorAll('[data-reveal]').forEach((item) => observer.observe(item));

const tourVideo = document.querySelector('.tour-video');
let tourVisible = true;
tourVideo.muted = true;
function syncTour() {
  if (!tourVisible || document.hidden) tourVideo.pause();
  else tourVideo.play().catch(() => {});
}
new IntersectionObserver(
  ([entry]) => {
    tourVisible = entry.isIntersecting;
    syncTour();
  },
  { threshold: 0.05 },
).observe(tourVideo);
document.addEventListener('visibilitychange', syncTour);
syncTour();
