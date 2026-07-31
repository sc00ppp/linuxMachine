import { createRoot } from 'react-dom/client';
import { lazy, Suspense } from 'react';
import '@fontsource-variable/nunito';
import './styles/tokens.css';
import './styles/global.css';
import './styles/glass.css';
import App from './App';

// One bundle, two homes (the o3code pattern): the same dev server serves the
// TV shell at / and the phone GamePad at /phone. Lazy so the TV never pays
// for phone code and vice versa.
const PhoneApp = lazy(() =>
  import('./phone/PhoneApp').then((m) => ({ default: m.PhoneApp })),
);

const isPhone = window.location.pathname.startsWith('/phone');

createRoot(document.getElementById('root')!).render(
  isPhone ? (
    <Suspense fallback={null}>
      <PhoneApp />
    </Suspense>
  ) : (
    <App />
  ),
);
