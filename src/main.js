import { initHeader } from "./header.js";

const header = document.querySelector("[data-site-header]");
const toggle = document.querySelector("[data-menu-toggle]");
const mobileNav = document.querySelector("[data-mobile-nav]");

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

initHeader();

const demoOpen = document.querySelector("[data-open-demo]");
const demoModal = document.querySelector("[data-video-modal]");

if (demoOpen && demoModal) {
  const demoVideo = demoModal.querySelector("video");
  const demoCloseButton = demoModal.querySelector(".video-modal-close");
  const demoBackdrop = [document.querySelector(".site-header"), document.querySelector("main"), document.querySelector(".site-footer")];
  let demoScrollY = 0;
  let demoReturnFocus = null;

  const lockPage = () => {
    demoScrollY = window.scrollY;
    document.body.style.position = "fixed";
    document.body.style.top = `-${demoScrollY}px`;
    document.body.style.left = "0";
    document.body.style.right = "0";
    document.body.style.width = "100%";
    demoBackdrop.forEach((node) => {
      if (node) node.inert = true;
    });
  };

  const unlockPage = () => {
    document.body.style.position = "";
    document.body.style.top = "";
    document.body.style.left = "";
    document.body.style.right = "";
    document.body.style.width = "";
    demoBackdrop.forEach((node) => {
      if (node) node.inert = false;
    });
    const root = document.documentElement;
    const previous = root.style.scrollBehavior;
    root.style.scrollBehavior = "auto";
    window.scrollTo(0, demoScrollY);
    root.style.scrollBehavior = previous;
  };

  const closeDemo = () => {
    if (demoModal.hidden) return;
    if (demoVideo) demoVideo.pause();
    demoModal.hidden = true;
    document.removeEventListener("keydown", onDemoKey);
    unlockPage();
    if (demoReturnFocus instanceof HTMLElement) demoReturnFocus.focus();
  };

  const onDemoKey = (event) => {
    if (event.key === "Escape") {
      event.preventDefault();
      closeDemo();
    }
  };

  const openDemo = () => {
    if (!demoModal.hidden) return;
    demoReturnFocus = document.activeElement;
    demoModal.hidden = false;
    lockPage();
    document.addEventListener("keydown", onDemoKey);
    if (demoCloseButton) demoCloseButton.focus();
  };

  demoOpen.addEventListener("click", openDemo);
  demoModal.addEventListener("click", (event) => {
    const target = event.target;
    if (target instanceof Element && target.closest("[data-video-close]")) closeDemo();
  });
}

