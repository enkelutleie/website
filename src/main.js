const header = document.querySelector("[data-site-header]");
const toggle = document.querySelector("[data-menu-toggle]");
const mobileNav = document.querySelector("[data-mobile-nav]");
const carousel = document.querySelector("[data-phone-carousel]");

if (header) {
  const onScroll = () => {
    header.classList.toggle("is-scrolled", window.scrollY > 8);
  };

  onScroll();
  window.addEventListener("scroll", onScroll, { passive: true });
}

if (toggle && mobileNav) {
  const setOpen = (open) => {
    toggle.setAttribute("aria-expanded", String(open));
    mobileNav.hidden = !open;
  };

  toggle.addEventListener("click", () => {
    setOpen(mobileNav.hidden);
  });

  mobileNav.querySelectorAll("a").forEach((link) => {
    link.addEventListener("click", () => setOpen(false));
  });
}

if (carousel) {
  const slides = [...carousel.querySelectorAll("[data-slide]")];
  const dots = [...document.querySelectorAll("[data-phone-dot]")];
  const prev = document.querySelector("[data-phone-prev]");
  const next = document.querySelector("[data-phone-next]");
  let index = 0;

  const show = (nextIndex) => {
    index = (nextIndex + slides.length) % slides.length;
    slides.forEach((slide, i) => {
      const active = i === index;
      slide.hidden = !active;
      slide.classList.toggle("is-active", active);
    });
    dots.forEach((dot, i) => {
      dot.classList.toggle("is-active", i === index);
    });
  };

  prev?.addEventListener("click", () => show(index - 1));
  next?.addEventListener("click", () => show(index + 1));
  dots.forEach((dot, i) => {
    dot.addEventListener("click", () => show(i));
  });

  show(0);
}
