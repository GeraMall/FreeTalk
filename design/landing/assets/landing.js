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

const tour = document.querySelector('#productTour');
const tourVideo = tour.querySelector('video');
const tourLaunch = document.querySelector('.tour-launch');
tourLaunch.addEventListener('click', () => {
  const source = tourVideo.querySelector('source');
  if (!source.getAttribute('src')) {
    source.src = source.dataset.src;
    tourVideo.load();
  }
  tour.showModal();
  document.documentElement.classList.add('tour-open');
  tourVideo.play().catch(() => {
    /* Native play control remains available. */
  });
});
tour.querySelector('.tour-close').addEventListener('click', () => tour.close());
tour.addEventListener('click', (event) => {
  if (event.target === tour) {
    const rect = tour.getBoundingClientRect();
    if (
      event.clientX < rect.left ||
      event.clientX > rect.right ||
      event.clientY < rect.top ||
      event.clientY > rect.bottom
    )
      tour.close();
  }
});
tour.addEventListener('close', () => {
  tourVideo.pause();
  document.documentElement.classList.remove('tour-open');
  tourLaunch.focus({ preventScroll: true });
});
