/* global document */
const menuButton = document.querySelector('.menu-button');
const nav = document.querySelector('.nav');
function setMenuOpen(open) {
  nav.classList.toggle('open', open);
  menuButton.setAttribute('aria-expanded', String(open));
  menuButton.setAttribute('aria-label', open ? 'Закрыть меню' : 'Открыть меню');
  menuButton.textContent = open ? '×' : '☰';
}
menuButton.addEventListener('click', () => setMenuOpen(!nav.classList.contains('open')));
document.querySelectorAll('.nav-links a').forEach((link) => {
  link.addEventListener('click', () => setMenuOpen(false));
});
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && nav.classList.contains('open')) {
    setMenuOpen(false);
    menuButton.focus();
  }
});
document.addEventListener('click', (event) => {
  if (!nav.contains(event.target)) setMenuOpen(false);
});
