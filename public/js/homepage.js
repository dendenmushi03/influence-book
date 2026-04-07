(() => {
  const revealTargets = document.querySelectorAll('[data-reveal]');

  if ('IntersectionObserver' in window && revealTargets.length > 0) {
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            entry.target.classList.add('is-visible');
            observer.unobserve(entry.target);
          }
        });
      },
      { threshold: 0.18, rootMargin: '0px 0px -8% 0px' }
    );

    revealTargets.forEach((target) => observer.observe(target));
  } else {
    revealTargets.forEach((target) => target.classList.add('is-visible'));
  }

  const heroVisual = document.querySelector('.hero-visual-premium');
  const supportsMatchMedia = typeof window.matchMedia === 'function';
  if (!heroVisual || (supportsMatchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches)) {
    return;
  }

  const updateParallax = () => {
    const rect = heroVisual.getBoundingClientRect();
    const offset = Math.max(Math.min((window.innerHeight - rect.top) * 0.018, 14), -8);
    heroVisual.style.setProperty('--hero-media-shift', `${offset}px`);
  };

  let ticking = false;
  const onScroll = () => {
    if (ticking) {
      return;
    }
    ticking = true;
    window.requestAnimationFrame(() => {
      updateParallax();
      ticking = false;
    });
  };

  updateParallax();
  window.addEventListener('scroll', onScroll, { passive: true });
  window.addEventListener('resize', onScroll, { passive: true });
})();
