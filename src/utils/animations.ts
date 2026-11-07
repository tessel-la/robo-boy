import anime from 'animejs';

export const prefersReducedMotion = () =>
  typeof window !== 'undefined' && Boolean(window.matchMedia?.('(prefers-reduced-motion: reduce)').matches);

/**
 * Animates the landing page elements
 * @param containerRef - Reference to the main container element
 * @param logoRef - Reference to the logo container element
 */
export const animateLandingPage = (containerRef: HTMLElement | null, logoRef: HTMLElement | null) => {
  if (!containerRef) return;
  if (prefersReducedMotion()) {
    for (const element of [containerRef.querySelector<HTMLElement>('.entry-section'), logoRef]) {
      if (element) {
        element.style.opacity = '1';
        element.style.transform = 'none';
      }
    }
    return;
  }

  // Make container visible - cast Element to HTMLElement
  const entrySection = containerRef.querySelector('.entry-section');
  if (entrySection) {
    anime({
      targets: entrySection as HTMLElement,
      opacity: [0, 1],
      translateY: [20, 0],
      easing: 'easeOutQuad',
      duration: 800,
    });
  }

  // Animate logo with delay
  if (logoRef) {
    anime({
      targets: logoRef,
      opacity: [0, 1],
      translateY: [-20, 0],
      easing: 'easeOutExpo',
      duration: 1000,
      delay: 200,
    });
  }
};

/**
 * Animates the advanced form section
 * @param formRef - Reference to the form element
 * @param isVisible - Whether the form should be visible
 */
export const animateAdvancedForm = (formRef: HTMLElement | null, isVisible: boolean) => {
  if (!formRef) return;
  anime.remove(formRef);
  formRef.inert = !isVisible;
  if (prefersReducedMotion()) {
    formRef.classList.toggle('visible', isVisible);
    formRef.style.opacity = isVisible ? '1' : '0';
    return;
  }

  if (isVisible) {
    // Add visible class for CSS transition to work
    formRef.classList.add('visible');

    // Additional anime.js animation
    anime({
      targets: formRef,
      opacity: [0, 1],
      duration: 500,
      easing: 'easeOutQuad',
    });
  } else {
    // Remove visible class for CSS transition to work
    anime({
      targets: formRef,
      opacity: 0,
      duration: 300,
      easing: 'easeOutQuad',
      complete: () => {
        formRef.classList.remove('visible');
      },
    });
  }
};

/**
 * Animation for button interaction (for quick connect or submit buttons)
 * @param element - Button element to animate
 */
export const animateButtonPress = (element: HTMLElement | null) => {
  if (!element || prefersReducedMotion()) return;

  anime({
    targets: element,
    scale: [1, 0.95, 1],
    duration: 300,
    easing: 'easeInOutQuad',
  });
};
