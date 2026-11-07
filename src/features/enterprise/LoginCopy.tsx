import { useEffect, useState } from 'react';
import type { Branding } from './config';
import { chooseLoginMessage, readLoginMessage, rememberLoginMessage } from './loginMessage';

function SurpriseMessage({ branding }: { branding: Branding }) {
  const scope = `${branding.theme?.id ?? ''}:${branding.name}`;
  const [message] = useState(() => chooseLoginMessage(branding.loginSlides, readLoginMessage(scope)));
  useEffect(() => rememberLoginMessage(scope, message), [scope, message]);
  return (
    <>
      <h1 id="enterprise-login-title">{message.title}</h1>
      {message.message && <p>{message.message}</p>}
    </>
  );
}

/** One surprise per login visit. Auth checks and other rerenders keep the same paired copy. */
export default function LoginCopy({ branding }: { branding: Branding }) {
  const copy = branding.loginSlides[0] ?? { title: branding.loginTitle, message: branding.loginMessage };
  return (
    <>
      {branding.loginEyebrow && <span className="enterprise-eyebrow">{branding.loginEyebrow}</span>}
      {branding.loginSlides.length > 1 ? (
        <SurpriseMessage
          key={JSON.stringify([branding.name, branding.theme?.id, branding.loginSlides])}
          branding={branding}
        />
      ) : (
        <>
          <h1 id="enterprise-login-title">{copy.title}</h1>
          {copy.message && <p>{copy.message}</p>}
        </>
      )}
    </>
  );
}
