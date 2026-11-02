/* global document, IntersectionObserver */
const menuButton = document.querySelector('.menu-button');
const nav = document.querySelector('.nav');
menuButton.addEventListener('click', () => {
  const open = nav.classList.toggle('open');
  menuButton.setAttribute('aria-expanded', String(open));
  menuButton.textContent = open ? '×' : '☰';
});
document.querySelectorAll('.nav-links a').forEach((link) =>
  link.addEventListener('click', () => {
    nav.classList.remove('open');
    menuButton.setAttribute('aria-expanded', 'false');
    menuButton.textContent = '☰';
  }),
);
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
const tourToggle = document.querySelector('.tour-toggle');
let pausedByUser = false;
let tourVisible = true;
tourVideo.muted = true;
function syncTour() {
  if (pausedByUser || !tourVisible || document.hidden) tourVideo.pause();
  else tourVideo.play().catch(() => {});
}
function syncTourButton() {
  tourToggle.textContent = tourVideo.paused ? 'Продолжить' : 'Пауза';
  tourToggle.setAttribute(
    'aria-label',
    tourVideo.paused ? 'Воспроизвести видео' : 'Приостановить видео',
  );
}
tourToggle.addEventListener('click', () => {
  pausedByUser = !tourVideo.paused;
  syncTour();
});
tourVideo.addEventListener('play', syncTourButton);
tourVideo.addEventListener('pause', syncTourButton);
new IntersectionObserver(
  ([entry]) => {
    tourVisible = entry.isIntersecting;
    syncTour();
  },
  { threshold: 0.05 },
).observe(tourVideo);
document.addEventListener('visibilitychange', syncTour);
syncTour();
