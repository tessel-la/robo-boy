const createElement = (tagName, className, text) => {
  const element = document.createElement(tagName);
  element.className = className;
  if (text !== undefined) element.textContent = text;
  return element;
};

const definition = {
  apiVersion: '1.0.0',
  id: 'la.tessel.roboboy.hello',
  activate(context) {
    let root = null;
    let button = null;
    let count = context.storage?.get('greetings', 0) || 0;

    const updateButton = () => {
      if (button) button.textContent = `Send greeting (${count})`;
    };

    const sendGreeting = () => {
      count += 1;
      context.storage?.set('greetings', count);
      context.logger.info(`Greeting ${count} sent.`);
      updateButton();
    };

    return {
      mount(container) {
        root = createElement('section', 'roboboy-hello-panel');
        Object.assign(root.style, {
          height: '100%',
          boxSizing: 'border-box',
          display: 'grid',
          placeItems: 'center',
          padding: '24px',
          color: 'var(--text-color, #f5f7fb)',
          background: 'linear-gradient(145deg, var(--background-secondary, #252b35), var(--card-bg, #1f242d))',
        });

        const content = createElement('div', 'roboboy-hello-panel__content');
        Object.assign(content.style, { maxWidth: '420px', textAlign: 'center' });
        const eyebrow = createElement('span', 'roboboy-hello-panel__eyebrow', 'EXTERNAL PANEL');
        Object.assign(eyebrow.style, {
          color: 'var(--primary-color, #60a5fa)',
          fontSize: '0.72rem',
          fontWeight: '800',
          letterSpacing: '0.14em',
        });
        const title = createElement('h2', 'roboboy-hello-panel__title', 'Hello from outside Robo-Boy');
        Object.assign(title.style, { margin: '10px 0 8px' });
        const description = createElement(
          'p',
          'roboboy-hello-panel__description',
          'This independently built module was discovered from the installed panel registry and loaded only when this tile mounted.'
        );
        Object.assign(description.style, {
          margin: '0 0 18px',
          color: 'var(--text-secondary, #cbd5e1)',
          lineHeight: '1.55',
        });
        button = createElement('button', 'roboboy-hello-panel__button');
        button.type = 'button';
        Object.assign(button.style, {
          padding: '9px 16px',
          border: '0',
          borderRadius: '7px',
          color: '#fff',
          background: 'var(--primary-color, #3b82f6)',
          cursor: 'pointer',
          fontWeight: '700',
        });
        button.addEventListener('click', sendGreeting);
        updateButton();
        content.append(eyebrow, title, description, button);
        root.append(content);
        container.replaceChildren(root);
      },
      setActive(isActive) {
        if (root) root.toggleAttribute('data-inactive', !isActive);
      },
      unmount() {
        button?.removeEventListener('click', sendGreeting);
        root?.remove();
        button = null;
        root = null;
      },
    };
  },
};

export default definition;
