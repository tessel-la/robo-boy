import { useEffect, useState } from 'react';
import { FiChevronLeft, FiChevronRight, FiPause, FiPlay } from 'react-icons/fi';
import type { Branding } from './config';

/** Public copy stays declarative; its timer belongs to the login screen, never the auth session. */
export default function LoginCopy({ branding }: { branding: Branding }) {
  const slides = branding.loginSlides;
  const multiple = slides.length > 1;
  const [index, setIndex] = useState(0);
  const [playing, setPlaying] = useState(true);
  const [hovered, setHovered] = useState(false);
  const [hidden, setHidden] = useState(document.hidden);
  const [reducedMotion, setReducedMotion] = useState(
    () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false
  );

  useEffect(() => {
    if (!multiple) return;
    const motion = window.matchMedia?.('(prefers-reduced-motion: reduce)');
    const onMotion = () => setReducedMotion(motion?.matches ?? false);
    const onVisibility = () => setHidden(document.hidden);
    motion?.addEventListener('change', onMotion);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      motion?.removeEventListener('change', onMotion);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [multiple]);

  useEffect(() => {
    if (!multiple || !playing || reducedMotion || hovered || hidden) return;
    const timer = window.setInterval(() => setIndex(current => (current + 1) % slides.length), 8000);
    return () => window.clearInterval(timer);
  }, [multiple, playing, reducedMotion, hovered, hidden, slides.length]);

  const move = (direction: number) => {
    setPlaying(false);
    setIndex(current => (current + direction + slides.length) % slides.length);
  };
  const eyebrow = branding.loginEyebrow && <span className="enterprise-eyebrow">{branding.loginEyebrow}</span>;
  if (!multiple) {
    const copy = slides[0] ?? { title: branding.loginTitle, message: branding.loginMessage };
    return (
      <>
        {eyebrow}
        <h1 id="enterprise-login-title">{copy.title}</h1>
        {copy.message && <p>{copy.message}</p>}
      </>
    );
  }

  return (
    <>
      {eyebrow}
      <div
        className="enterprise-login-copy"
        role="region"
        aria-label="Company messages"
        aria-roledescription="carousel"
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        onFocusCapture={event => {
          if (!(event.target as HTMLElement).closest('[data-rotation-toggle]')) setPlaying(false);
        }}
      >
        {/* Overlaid slides reserve the tallest copy's space so sign-in buttons never jump. */}
        <div className="enterprise-login-slides" aria-live={playing && !reducedMotion ? 'off' : 'polite'}>
          {slides.map((slide, position) => (
            <div
              className="enterprise-login-slide"
              key={position}
              role="group"
              aria-roledescription="slide"
              aria-label={`Message ${position + 1} of ${slides.length}`}
              aria-hidden={position !== index}
            >
              <h1 id={position === index ? 'enterprise-login-title' : undefined}>{slide.title}</h1>
              {slide.message && <p>{slide.message}</p>}
            </div>
          ))}
        </div>
        <div className="enterprise-copy-controls">
          <button type="button" aria-label="Previous message" onClick={() => move(-1)}>
            <FiChevronLeft aria-hidden="true" />
          </button>
          <span aria-hidden="true">
            {index + 1} / {slides.length}
          </span>
          <button type="button" aria-label="Next message" onClick={() => move(1)}>
            <FiChevronRight aria-hidden="true" />
          </button>
          {!reducedMotion && (
            <button
              type="button"
              data-rotation-toggle
              aria-label={playing ? 'Pause messages' : 'Play messages'}
              onClick={() => setPlaying(current => !current)}
            >
              {playing ? <FiPause aria-hidden="true" /> : <FiPlay aria-hidden="true" />}
            </button>
          )}
        </div>
      </div>
    </>
  );
}
