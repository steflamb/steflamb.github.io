// On phones a demo only makes sense once all of it is on screen, so instead of starting as it
// scrolls past, it waits behind a clear "Start demo" button that also brings it fully into view.
const compact = window.matchMedia('(max-width: 54rem), (pointer: coarse)');
const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

export function onDemoStart(root: HTMLElement, stage: HTMLElement, start: () => void, label = 'Start demo') {
  if (!compact.matches) {
    new IntersectionObserver(
      ([entry], observer) => {
        if (!entry.isIntersecting) return;
        observer.disconnect();
        start();
      },
      { rootMargin: '300px 0px' },
    ).observe(root);
    return;
  }
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'demo-start';
  button.innerHTML = '<span></span>';
  button.querySelector('span')!.textContent = label;
  stage.append(button);
  button.addEventListener('click', () => {
    button.remove();
    root.scrollIntoView({ behavior: reduceMotion.matches ? 'auto' : 'smooth', block: 'start' });
    start();
  });
}
